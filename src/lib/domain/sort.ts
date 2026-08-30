import type { SortDir } from '@/hooks/use-server-paginated-list';

/**
 * 服务端列表排序参数解析。
 *
 * 前端列头通过 query 传 `sortBy=<列字段>&sortDir=asc|desc`；后端必须用**白名单**
 * 限制可排序列，否则 sortBy 会被拼进 Supabase order() 造成列注入。
 *
 * @param sortBy 前端传入的排序字段（语义化 key，与白名单的 key 对应）
 * @param sortDir 方向，非法值默认 desc
 * @param allowed 允许排序的字段映射：key（前端用）→ 数据库列名
 * @returns Supabase order() 可用的 { column, ascending }，或 null（用调用方默认排序）
 */
export function parseSort(
  sortBy: string | null | undefined,
  sortDir: string | null | undefined,
  allowed: Record<string, string>,
): { column: string; ascending: boolean } | null {
  if (!sortBy) return null;
  const column = allowed[sortBy];
  if (!column) return null; // 白名单外字段一律忽略，防注入
  const dir: SortDir = sortDir === 'asc' ? 'asc' : 'desc';
  return { column, ascending: dir === 'asc' };
}
