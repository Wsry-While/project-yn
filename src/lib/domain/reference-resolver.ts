import type { SupabaseClient } from '@supabase/supabase-js';

type SchoolRow = { id: string; name: string };
type DeptRow = { id: string; school_id: string; name: string; dept_type: string };
type AliasRow = { school_id: string; alias: string };
type DeptAliasRow = { department_id: string; alias: string };

/** 去空白/全角空格/括号备注后做比对 */
function looseEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const norm = (s: string) =>
    s.replace(/[\s\u3000]+/g, '').replace(/[（(].*?[)）]/g, '').trim().toLowerCase();
  return norm(a) === norm(b);
}

/**
 * 进程级 LRU-ish 解析缓存：把"名字 → 解析到的 uuid"按类型缓存 10 分钟，
 * 用于减少推送接口高峰期对 schools / school_aliases 等表的全表扫描。
 * - 仅缓存"命中已有记录"的结果；自动创建新学校不缓存（避免短时间内重复并发创建）；
 * - 命中缓存后仍会进入一次 loose 校验以防同名歧义；
 * - 容量上限 2000 条，超出后按插入顺序淘汰最早的 25%。
 */
const RESOLVE_TTL_MS = 10 * 60 * 1000;
const RESOLVE_MAX = 2000;
const resolveCache = new Map<string, { value: string; expiresAt: number }>();

function cacheGet(namespace: string, key: string): string | null {
  const cacheKey = `${namespace}:${key.trim().toLowerCase()}`;
  const hit = resolveCache.get(cacheKey);
  if (!hit) return null;
  if (hit.expiresAt < Date.now()) {
    resolveCache.delete(cacheKey);
    return null;
  }
  // LRU touch
  resolveCache.delete(cacheKey);
  resolveCache.set(cacheKey, hit);
  return hit.value;
}

function cacheSet(namespace: string, key: string, value: string): void {
  const cacheKey = `${namespace}:${key.trim().toLowerCase()}`;
  if (resolveCache.size >= RESOLVE_MAX) {
    const drop = Math.floor(RESOLVE_MAX * 0.25);
    let dropped = 0;
    for (const k of resolveCache.keys()) {
      resolveCache.delete(k);
      dropped += 1;
      if (dropped >= drop) break;
    }
  }
  resolveCache.set(cacheKey, { value, expiresAt: Date.now() + RESOLVE_TTL_MS });
}

function cacheInvalidatePrefix(prefix: string): void {
  const fullPrefix = `${prefix}:`;
  for (const k of resolveCache.keys()) {
    if (k.startsWith(fullPrefix)) resolveCache.delete(k);
  }
}

/**
 * 学校 / 部门解析器：
 * - 按 schools.name → school_aliases.alias → 规范化名称 LIKE 的顺序查找
 * - 找不到时自动创建学校（与 SchoolService.findOrCreateSchoolByName 行为一致）
 * - 学院/部门解析时需要先有 schoolId
 */
export class ReferenceResolver {
  private schoolsCache: SchoolRow[] | null = null;
  private schoolAliasesCache: AliasRow[] | null = null;
  private departmentsCache: DeptRow[] | null = null;
  private departmentAliasesCache: DeptAliasRow[] | null = null;

  constructor(private readonly db: SupabaseClient) {}

  private async ensureSchools(): Promise<SchoolRow[]> {
    if (this.schoolsCache) return this.schoolsCache;
    const { data } = await this.db.from('schools').select('id, name');
    this.schoolsCache = (data as SchoolRow[]) ?? [];
    return this.schoolsCache;
  }

  private async ensureSchoolAliases(): Promise<AliasRow[]> {
    if (this.schoolAliasesCache) return this.schoolAliasesCache;
    const { data } = await this.db.from('school_aliases').select('school_id, alias');
    this.schoolAliasesCache = (data as AliasRow[]) ?? [];
    return this.schoolAliasesCache;
  }

  private async ensureDepartments(): Promise<DeptRow[]> {
    if (this.departmentsCache) return this.departmentsCache;
    const { data } = await this.db.from('school_departments').select('id, school_id, name, dept_type');
    this.departmentsCache = (data as DeptRow[]) ?? [];
    return this.departmentsCache;
  }

  private async ensureDepartmentAliases(): Promise<DeptAliasRow[]> {
    if (this.departmentAliasesCache) return this.departmentAliasesCache;
    const { data } = await this.db.from('school_department_aliases').select('department_id, alias');
    this.departmentAliasesCache = (data as DeptAliasRow[]) ?? [];
    return this.departmentAliasesCache;
  }

  /** 清空实例级缓存，推送/回填结束后可调用；进程级解析缓存只失效不直接清空。 */
  resetCache(): void {
    this.schoolsCache = null;
    this.schoolAliasesCache = null;
    this.departmentsCache = null;
    this.departmentAliasesCache = null;
  }

  async resolveSchool(name: string | null | undefined): Promise<string | null> {
    const trimmed = name?.trim();
    if (!trimmed) return null;

    // 0. 进程级缓存命中
    const cached = cacheGet('school', trimmed);
    if (cached) {
      const schools = await this.ensureSchools();
      const valid = schools.find((s) => s.id === cached);
      if (valid) return valid.id;
      cacheInvalidatePrefix('school');
    }

    const schools = await this.ensureSchools();

    // 1. 精确名称
    const exact = schools.find((s) => s.name === trimmed);
    if (exact) {
      cacheSet('school', trimmed, exact.id);
      return exact.id;
    }

    // 2. 别名
    const aliases = await this.ensureSchoolAliases();
    const byAlias = aliases.find((a) => a.alias === trimmed);
    if (byAlias) {
      cacheSet('school', trimmed, byAlias.school_id);
      return byAlias.school_id;
    }

    // 3. 规范化（去空格/括号）匹配
    const loose = schools.find((s) => looseEqual(s.name, trimmed));
    if (loose) {
      cacheSet('school', trimmed, loose.id);
      return loose.id;
    }
    const looseAlias = aliases.find((a) => looseEqual(a.alias, trimmed));
    if (looseAlias) {
      cacheSet('school', trimmed, looseAlias.school_id);
      return looseAlias.school_id;
    }

    // 4. 子串包含（学校名包含输入，或输入包含学校名）
    const lower = trimmed.toLowerCase();
    const fuzzy = schools.find(
      (s) => s.name.toLowerCase().includes(lower) || lower.includes(s.name.toLowerCase()),
    );
    if (fuzzy) {
      cacheSet('school', trimmed, fuzzy.id);
      return fuzzy.id;
    }

    // 5. 都没命中：自动创建学校（沿用外部来源）
    const { data, error } = await this.db
      .from('schools')
      .insert({ name: trimmed, external_source: 'chaoxing' })
      .select('id, name')
      .single<SchoolRow>();
    if (error) {
      // 并发
      const retry = await this.db.from('schools').select('id, name').eq('name', trimmed).maybeSingle<SchoolRow>();
      if (retry.data) {
        this.schoolsCache = null;
        cacheSet('school', trimmed, retry.data.id);
        return retry.data.id;
      }
      return null;
    }
    this.schoolsCache = null;
    // 自动创建的结果缓存 30 秒，给并发请求一个短暂窗口命中，避免重复插入冲突；
    // 同时不会因为名称后续被改名而长时间指向错误记录。
    const cacheKey = `school:${trimmed.toLowerCase()}`;
    resolveCache.set(cacheKey, { value: data.id, expiresAt: Date.now() + 30_000 });
    return data.id;
  }

  /**
   * 解析学院/部门。type 可选：'college' | 'department'。
   * 找不到时会自动创建一条 school_departments 记录。
   */
  async resolveDepartment(
    schoolId: string | null,
    name: string | null | undefined,
    type: 'college' | 'department' = 'department',
  ): Promise<string | null> {
    const trimmed = name?.trim();
    if (!trimmed) return null;

    const cacheNs = `dept:${schoolId ?? '_'}:${type}`;
    const cached = cacheGet(cacheNs, trimmed);
    if (cached) {
      const depts = await this.ensureDepartments();
      const valid = depts.find((d) => d.id === cached);
      if (valid) return valid.id;
      cacheInvalidatePrefix('dept:');
    }

    const depts = await this.ensureDepartments();
    const inSchool = depts.filter((d) => !schoolId || d.school_id === schoolId);

    const exact = inSchool.find((d) => d.name === trimmed);
    if (exact) {
      cacheSet(cacheNs, trimmed, exact.id);
      return exact.id;
    }

    const deptAliases = await this.ensureDepartmentAliases();
    const candidateIds = new Set(inSchool.map((d) => d.id));
    const byAlias = deptAliases.find((a) => candidateIds.has(a.department_id) && a.alias === trimmed);
    if (byAlias) {
      cacheSet(cacheNs, trimmed, byAlias.department_id);
      return byAlias.department_id;
    }

    const loose = inSchool.find((d) => looseEqual(d.name, trimmed));
    if (loose) {
      cacheSet(cacheNs, trimmed, loose.id);
      return loose.id;
    }

    if (!schoolId) return null;

    // 自动创建
    const { data, error } = await this.db
      .from('school_departments')
      .insert({ school_id: schoolId, name: trimmed, dept_type: type })
      .select('id, school_id, name, dept_type')
      .single<DeptRow>();
    if (error) {
      const retry = await this.db
        .from('school_departments')
        .select('id, school_id, name, dept_type')
        .eq('school_id', schoolId)
        .eq('name', trimmed)
        .maybeSingle<DeptRow>();
      if (retry.data) {
        this.departmentsCache = null;
        cacheSet(cacheNs, trimmed, retry.data.id);
        return retry.data.id;
      }
      return null;
    }
    this.departmentsCache = null;
    // 自动创建的部门短缓存 30s，防并发重复插入
    const cacheKey = `${cacheNs}:${trimmed.toLowerCase()}`;
    resolveCache.set(cacheKey, { value: data.id, expiresAt: Date.now() + 30_000 });
    return data.id;
  }
}
