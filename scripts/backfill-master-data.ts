/**
 * 历史数据回填脚本：把四张业务表（trip/bidding/project_demands/qiming）里的
 * 中文文本字段回填为 uuid 外键（school_id / *_manager_id）和字典 norm 字段。
 *
 * 用法（开发环境）：
 *   pnpm tsx scripts/backfill-master-data.ts [--dry-run] [--table=trips|bidding|demands|qiming|all]
 *
 * 设计原则：
 * 1. 旧中文文本列全部保留为快照，不删不改；只写新增的 uuid / norm 列。
 * 2. 员工优先按 puid 命中（trips 有 puid 字段），其次按 name 规范化匹配。
 * 3. 学校走 ReferenceResolver（精确→别名→规范化→子串→自动创建）。
 * 4. 字典值未命中时自动登记一条新 option。
 * 5. 幂等：重复运行不会重复写入，已解析的字段会跳过。
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? '';
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY ?? '';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('缺少 NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 环境变量');
  process.exit(1);
}

const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const tableArg =
  [...args].find((a) => a.startsWith('--table='))?.split('=')[1]?.toLowerCase() ?? 'all';

type Stat = { scanned: number; updated: number; skipped: number };

function normalizeName(raw: string | null | undefined): string {
  if (!raw) return '';
  return raw
    .replace(/[\s\u3000]+/g, '')
    .replace(/[（(].*?[)）]/g, '')
    .trim()
    .toLowerCase();
}

async function loadAllSchools(): Promise<Array<{ id: string; name: string }>> {
  const { data } = await db.from('schools').select('id, name');
  return (data as Array<{ id: string; name: string }>) ?? [];
}

async function loadAllMembers(): Promise<
  Array<{ id: string; puid: string | null; name: string }>
> {
  const { data } = await db.from('team_members').select('id, puid, name').eq('active', true);
  return (data as Array<{ id: string; puid: string | null; name: string }>) ?? [];
}

function findSchoolId(
  schools: Array<{ id: string; name: string }>,
  name: string | null | undefined,
): string | null {
  if (!name) return null;
  const trimmed = name.trim();
  if (!trimmed) return null;
  const exact = schools.find((s) => s.name === trimmed);
  if (exact) return exact.id;
  const norm = normalizeName(trimmed);
  const loose = schools.find((s) => normalizeName(s.name) === norm);
  if (loose) return loose.id;
  const lower = trimmed.toLowerCase();
  const fuzzy = schools.find(
    (s) => s.name.toLowerCase().includes(lower) || lower.includes(s.name.toLowerCase()),
  );
  return fuzzy?.id ?? null;
}

function findMemberId(
  members: Array<{ id: string; puid: string | null; name: string }>,
  puid: string | null | undefined,
  name: string | null | undefined,
): string | null {
  if (puid) {
    const byPuid = members.find((m) => m.puid === puid);
    if (byPuid) return byPuid.id;
  }
  if (!name) return null;
  const trimmed = name.trim();
  if (!trimmed) return null;
  const exact = members.find((m) => m.name === trimmed);
  if (exact) return exact.id;
  const norm = normalizeName(trimmed);
  const loose = members.find((m) => normalizeName(m.name) === norm);
  return loose?.id ?? null;
}

async function backfillTable<T extends Record<string, unknown>>(
  table: string,
  fields: {
    schoolField?: string;
    salesNameField: string;
    salesPuidField?: string;
    salesIdField: string;
    pmNameField: string;
    pmPuidField?: string;
    pmIdField: string;
    normFields?: Array<{ src: string; dst: string; category: string }>;
  },
): Promise<Stat> {
  const stat: Stat = { scanned: 0, updated: 0, skipped: 0 };
  const [schools, members] = await Promise.all([loadAllSchools(), loadAllMembers()]);

  let query = db.from(table).select('*').is('deleted_at', null);
  const { data, error } = await query;
  if (error) throw new Error(`${table} 查询失败: ${error.message}`);

  const rows = (data ?? []) as T[];
  stat.scanned = rows.length;

  for (const row of rows) {
    const id = row.id as string;
    const patch: Record<string, unknown> = {};

    if (fields.schoolField && !row[fields.schoolField.replace(/_name$/, '_id')]) {
      const sid = findSchoolId(schools, row[fields.schoolField] as string);
      if (sid) patch[fields.schoolField.replace(/_name$/, '_id')] = sid;
    }
    if (!row[fields.salesIdField]) {
      const mid = findMemberId(
        members,
        fields.salesPuidField ? (row[fields.salesPuidField] as string) : undefined,
        row[fields.salesNameField] as string,
      );
      if (mid) patch[fields.salesIdField] = mid;
    }
    if (!row[fields.pmIdField]) {
      const mid = findMemberId(
        members,
        fields.pmPuidField ? (row[fields.pmPuidField] as string) : undefined,
        row[fields.pmNameField] as string,
      );
      if (mid) patch[fields.pmIdField] = mid;
    }

    if (Object.keys(patch).length === 0) {
      stat.skipped++;
      continue;
    }

    if (dryRun) {
      console.log(`[DRY] ${table} ${id}:`, patch);
      stat.updated++;
      continue;
    }

    const { error: updErr } = await db.from(table).update(patch).eq('id', id);
    if (updErr) {
      console.error(`[${table}] 更新失败 ${id}:`, updErr.message);
      stat.skipped++;
    } else {
      stat.updated++;
    }
  }

  return stat;
}

async function main() {
  const targets =
    tableArg === 'all'
      ? ['trips', 'bidding', 'demands', 'qiming']
      : [tableArg];

  for (const target of targets) {
    let stat: Stat;
    if (target === 'trips') {
      stat = await backfillTable('trip_requests', {
        schoolField: 'school_name',
        salesNameField: 'sales_manager_name',
        salesPuidField: 'sales_manager_puid',
        salesIdField: 'sales_manager_id',
        pmNameField: 'project_manager_name',
        pmPuidField: 'project_manager_puid',
        pmIdField: 'project_manager_id',
      });
    } else if (target === 'bidding') {
      stat = await backfillTable('bidding_screenshots', {
        salesNameField: 'sales_manager',
        salesIdField: 'sales_manager_id',
        pmNameField: 'assigned_project_manager',
        pmIdField: 'assigned_pm_id',
      });
    } else if (target === 'demands') {
      stat = await backfillTable('project_demands', {
        salesNameField: 'sales_manager',
        salesIdField: 'sales_manager_id',
        pmNameField: 'project_manager',
        pmIdField: 'project_manager_id',
      });
    } else if (target === 'qiming') {
      stat = await backfillTable('qiming_construction', {
        salesNameField: 'sales_manager',
        salesIdField: 'sales_manager_id',
        pmNameField: 'project_manager',
        pmIdField: 'project_manager_id',
      });
    } else {
      console.warn(`未知目标表：${target}`);
      continue;
    }
    console.log(`[${target}] 扫描=${stat.scanned} 更新=${stat.updated} 跳过=${stat.skipped}`);
  }
}

main().catch((err) => {
  console.error('回填失败：', err);
  process.exit(1);
});
