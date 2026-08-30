'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch } from '@/lib/web/api-client';
import { showToast } from '@/lib/web/toast-store';

export interface PaginatedListResponse<T> {
  rows: T[];
  total: number;
}

export type SortDir = 'asc' | 'desc';

export interface SortState {
  by: string;
  dir: SortDir;
}

export interface UseServerPaginatedListOptions<F extends Record<string, string>> {
  /** 列表接口路径，如 '/api/trips' */
  endpoint: string;
  pageSize?: number;
  /** 初始筛选条件（均为字符串；空字符串表示不过滤） */
  initialFilters: F;
  /** 标记哪个筛选键是搜索词，对其做防抖；默认 'search' */
  searchKey?: keyof F;
  /** 搜索防抖毫秒，默认 300 */
  searchDebounceMs?: number;
  /** 错误时是否自动 toast，默认 true */
  toastOnError?: boolean;
  /** 自定义错误提示文案 */
  errorMessage?: string;
  /** 默认服务端排序（列头可覆盖） */
  defaultSort?: SortState;
}

export interface UseServerPaginatedListResult<T, F extends Record<string, string>> {
  rows: T[];
  total: number;
  loading: boolean;
  page: number;
  pageSize: number;
  totalPages: number;
  filters: F;
  /** 当前服务端排序（by=列字段，dir=asc/desc） */
  sort: SortState | null;
  /** 即时搜索值（输入框绑定用），debounce 后才同步到 filters[searchKey] 触发请求 */
  searchInput: string;
  setPage: (page: number) => void;
  setFilter: <K extends keyof F>(key: K, value: F[K]) => void;
  setSearchInput: (value: string) => void;
  /** 点击列头切换排序（同列 asc→desc→取消；新列默认 desc） */
  setSortBy: (by: string) => void;
  resetFilters: () => void;
  refresh: () => void;
  /** 用当前筛选条件请求全量数据（用于导出），返回全部行 */
  fetchAll: () => Promise<T[]>;
}

function buildQuery<F extends Record<string, string>>(
  filters: F,
  limit: number,
  offset: number,
  sort?: SortState | null,
): Record<string, string | number> {
  const q: Record<string, string | number> = { limit, offset };
  for (const [k, v] of Object.entries(filters)) {
    if (v !== undefined && v !== null && v !== '') q[k] = v;
  }
  if (sort?.by) {
    q.sortBy = sort.by;
    q.sortDir = sort.dir;
  }
  return q;
}

export function useServerPaginatedList<T, F extends Record<string, string>>(
  options: UseServerPaginatedListOptions<F>,
): UseServerPaginatedListResult<T, F> {
  const {
    endpoint,
    pageSize = 20,
    initialFilters,
    searchKey = 'search' as keyof F,
    searchDebounceMs = 300,
    toastOnError = true,
    errorMessage = '加载数据失败',
  } = options;

  const [rows, setRows] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPageState] = useState(1);
  const [filters, setFilters] = useState<F>(initialFilters);
  const [searchInput, setSearchInputState] = useState<string>(
    String(initialFilters[searchKey] ?? ''),
  );
  const [sort, setSort] = useState<SortState | null>(options.defaultSort ?? null);
  const [reloadTick, setReloadTick] = useState(0);

  // 保存最新请求标记，避免并发请求竞态
  const reqIdRef = useRef(0);

  // 搜索输入防抖 → 写入 filters[searchKey] 并回到第 1 页
  useEffect(() => {
    const timer = setTimeout(() => {
      setFilters((prev) => {
        if (String(prev[searchKey] ?? '') === searchInput) return prev;
        return { ...prev, [searchKey]: searchInput } as F;
      });
      setPageState(1);
    }, searchDebounceMs);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput, searchDebounceMs]);

  useEffect(() => {
    const reqId = ++reqIdRef.current;
    setLoading(true);
    const offset = (page - 1) * pageSize;
    apiFetch<PaginatedListResponse<T>>(endpoint, {
      query: buildQuery(filters, pageSize, offset, sort),
    })
      .then((res) => {
        if (reqId !== reqIdRef.current) return; // 已被更新请求取代
        setRows(res.rows ?? []);
        setTotal(res.total ?? 0);
      })
      .catch((err: unknown) => {
        if (reqId !== reqIdRef.current) return;
        setRows([]);
        setTotal(0);
        if (toastOnError) {
          showToast(err instanceof Error ? err.message : errorMessage, { kind: 'error' });
        }
      })
      .finally(() => {
        if (reqId === reqIdRef.current) setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endpoint, page, pageSize, filters, sort, reloadTick]);

  const setPage = useCallback((p: number) => {
    setPageState(Math.max(1, p));
  }, []);

  const setFilter = useCallback(<K extends keyof F>(key: K, value: F[K]) => {
    if (key === searchKey) {
      // 搜索词走防抖通道
      setSearchInputState(value);
      return;
    }
    setFilters((prev) => ({ ...prev, [key]: value }));
    setPageState(1);
  }, [searchKey]);

  const setSearchInput = useCallback((value: string) => {
    setSearchInputState(value);
  }, []);

  const resetFilters = useCallback(() => {
    setFilters(initialFilters);
    setSearchInputState(String(initialFilters[searchKey] ?? ''));
    setPageState(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refresh = useCallback(() => {
    setReloadTick((t) => t + 1);
  }, []);

  /**
   * 切换列排序：同一列 asc→desc→取消；切到新列默认 desc（业务列表多为"最新/最紧急优先"）。
   * 排序变化回到第 1 页。传 null 可清除排序（回后端默认）。
   */
  const setSortBy = useCallback((by: string) => {
    setSort((prev) => {
      if (!prev || prev.by !== by) return { by, dir: 'desc' };
      if (prev.dir === 'desc') return { by, dir: 'asc' };
      return null;
    });
    setPageState(1);
  }, []);

  const fetchAll = useCallback(async (): Promise<T[]> => {
    // 用较大 limit 一次拉全量，用于导出；受后端 limit 上限约束
    const res = await apiFetch<PaginatedListResponse<T>>(endpoint, {
      query: buildQuery(filters, 2000, 0, sort),
    });
    return res.rows ?? [];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endpoint, filters, sort]);

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / pageSize)), [total, pageSize]);

  return {
    rows,
    total,
    loading,
    page,
    pageSize,
    totalPages,
    filters,
    sort,
    searchInput,
    setPage,
    setFilter,
    setSearchInput,
    setSortBy,
    resetFilters,
    refresh,
    fetchAll,
  };
}
