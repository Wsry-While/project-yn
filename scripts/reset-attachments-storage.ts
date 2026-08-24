/**
 * 附件存储迁移重置脚本（一次性，用于从 Supabase Storage 切换到扣子内置对象存储）。
 *
 * 作用：
 * 1. 把 external_file_assets 里的转存状态重置回 pending（清掉旧 Supabase 的
 *    bucket/storage_key/stored_url/status），保留 objectId/file_name/suffix 等
 *    超星原始信息，这样用户下次点「获取」会重新从超星拉取并存入扣子内置存储。
 * 2. 把三张业务表 JSONB 附件字段里的转存状态（assetId/bucket/storageKey/
 *    storageStatus/storedAt/storageError/storedUrl）清空，保留 objectId/name/
 *    suffix/size/type/url 等超星原始字段。
 * 3. 可选：清空 external_file_assets 表（--purge-assets），让所有附件按全新流程重建。
 * 4. 可选：删除旧 Supabase Storage bucket 内的对象（--delete-objects）。
 *    注意：这会真正删除旧桶文件，建议先在 Supabase 控制台备份。
 *
 * 用法：
 *   pnpm tsx scripts/reset-attachments-storage.ts --dry-run           # 只预览，不写库
 *   pnpm tsx scripts/reset-attachments-storage.ts                     # 重置状态
 *   pnpm tsx scripts/reset-attachments-storage.ts --purge-assets      # 同时清空 asset 表
 *   pnpm tsx scripts/reset-attachments-storage.ts --delete-objects    # 同时删旧桶对象
 *
 * 环境变量（与应用一致，优先 COZE_*，兼容 SUPABASE_*）：
 *   COZE_SUPABASE_URL / COZE_SUPABASE_SERVICE_ROLE_KEY
 *   或 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
 *
 * ⚠️ 运行前强烈建议先在 Supabase 控制台备份数据库与 Storage。
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.COZE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? '';
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.COZE_SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const OLD_BUCKET = process.env.STORAGE_BUCKET?.trim() || 'bidding-attachments';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('缺少 COZE_SUPABASE_URL / COZE_SUPABASE_SERVICE_ROLE_KEY 环境变量');
  process.exit(1);
}

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const purgeAssets = args.has('--purge-assets');
const deleteObjects = args.has('--delete-objects');

const db: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/** 从单个附件 JSON 对象里剥离转存状态字段，保留超星原始字段。 */
function stripStorageState(file: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!file || typeof file !== 'object') return file;
  const next: Record<string, unknown> = { ...file };
  delete next.assetId;
  delete next.bucket;
  delete next.storageKey;
  delete next.storageStatus;
  delete next.storedAt;
  delete next.storageError;
  delete next.storedUrl;
  return next;
}

/** 处理一个可能是对象或数组的附件字段。 */
function resetField(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((f) => stripStorageState(f as Record<string, unknown>));
  if (value && typeof value === 'object') return stripStorageState(value as Record<string, unknown>);
  return value;
}

async function resetBusinessTable(
  table: string,
  columns: string[],
): Promise<{ scanned: number; updated: number }> {
  const { data, error } = await db.from(table).select('id, ' + columns.join(', '));
  if (error) throw new Error(`查询 ${table} 失败: ${error.message}`);
  const rows = (data ?? []) as unknown as Array<Record<string, unknown>>;
  let updated = 0;
  for (const row of rows) {
    const patch: Record<string, unknown> = {};
    let touched = false;
    for (const col of columns) {
      const original = row[col];
      if (original === null || original === undefined) continue;
      const reset = resetField(original);
      if (JSON.stringify(reset) !== JSON.stringify(original)) {
        patch[col] = reset;
        touched = true;
      }
    }
    if (!touched) continue;
    updated++;
    if (dryRun) continue;
    const { error: updError } = await db.from(table).update(patch).eq('id', row.id);
    if (updError) console.error(`  更新 ${table} ${row.id} 失败:`, updError.message);
  }
  return { scanned: rows.length, updated };
}

async function resetAssetTable(): Promise<{ total: number; reset: number }> {
  const { count, error } = await db
    .from('external_file_assets')
    .select('*', { count: 'exact', head: true });
  if (error) throw new Error(`查询 external_file_assets 失败: ${error.message}`);
  const total = count ?? 0;

  if (purgeAssets) {
    if (!dryRun) {
      // 分批删除，避免单次语句过大
      const { data } = await db.from('external_file_assets').select('id');
      const ids = ((data ?? []) as Array<{ id: string }>).map((r) => r.id);
      if (ids.length) {
        const { error: delError } = await db.from('external_file_assets').delete().in('id', ids);
        if (delError) throw new Error(`清空 external_file_assets 失败: ${delError.message}`);
      }
    }
    return { total, reset: total };
  }

  if (!dryRun) {
    // 把 stored/failed/direct 全部回退到 pending，清空存储定位字段。
    const { error: updError } = await db
      .from('external_file_assets')
      .update({
        status: 'pending',
        bucket: null,
        storage_key: null,
        stored_url: null,
        error_message: null,
        fetched_at: null,
      })
      .in('status', ['stored', 'failed', 'direct', 'fetching']);
    if (updError) throw new Error(`重置 external_file_assets 失败: ${updError.message}`);
  }
  return { total, reset: total };
}

async function deleteOldBucketObjects(): Promise<number> {
  // 列出旧桶所有对象并删除
  let deleted = 0;
  let offset = 0;
  const pageSize = 500;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { data, error } = await db.storage.from(OLD_BUCKET).list('', {
      limit: pageSize,
      offset,
      sortBy: { column: 'name', order: 'asc' },
    });
    if (error) throw new Error(`列出旧桶对象失败: ${error.message}`);
    if (!data || data.length === 0) break;
    const filePaths = data
      .filter((f) => f.name && f.id !== null)
      .map((f) => f.name!);
    if (filePaths.length && !dryRun) {
      const { error: rmError } = await db.storage.from(OLD_BUCKET).remove(filePaths);
      if (rmError) throw new Error(`删除旧桶对象失败: ${rmError.message}`);
    }
    deleted += filePaths.length;
    if (data.length < pageSize) break;
    offset += data.length;
  }
  return deleted;
}

async function main(): Promise<void> {
  console.log('=== 附件存储迁移重置 ===');
  console.log(`Supabase: ${SUPABASE_URL}`);
  console.log(`旧桶名:   ${OLD_BUCKET}`);
  console.log(`dry-run:  ${dryRun}`);
  console.log(`清空asset表: ${purgeAssets}`);
  console.log(`删除旧桶文件: ${deleteObjects}`);
  console.log('');

  const tables: Array<{ table: string; columns: string[] }> = [
    {
      table: 'bidding_screenshots',
      columns: ['project_bidding_file', 'delivery_document', 'attachments', 'rectified_document'],
    },
    { table: 'project_demands', columns: ['provided_materials', 'delivery_docs'] },
    { table: 'qiming_construction', columns: ['project_materials'] },
  ];

  for (const { table, columns } of tables) {
    const result = await resetBusinessTable(table, columns);
    console.log(`[${table}] 扫描 ${result.scanned} 行，需重置 ${result.updated} 行${dryRun ? '（预览）' : ''}`);
  }

  const assetResult = await resetAssetTable();
  console.log(
    `[external_file_assets] 共 ${assetResult.total} 条，${purgeAssets ? '将清空' : '将重置为 pending'} ${assetResult.reset} 条${dryRun ? '（预览）' : ''}`,
  );

  if (deleteObjects) {
    const deleted = await deleteOldBucketObjects();
    console.log(`[旧桶 ${OLD_BUCKET}] 删除对象 ${deleted} 个${dryRun ? '（预览）' : ''}`);
  }

  console.log('');
  if (dryRun) {
    console.log('预览完成，未做任何修改。确认无误后去掉 --dry-run 重新运行。');
  } else {
    console.log('重置完成。用户下次打开附件时点「获取」，将从超星重新拉取并存入扣子内置存储。');
  }
}

main().catch((err) => {
  console.error('重置失败:', err);
  process.exit(1);
});
