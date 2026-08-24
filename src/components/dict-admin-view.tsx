'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { BookMarked, Pencil, Plus, RefreshCw, Save, Search, Tag, X } from 'lucide-react';

import { cn } from '@/lib/utils';
import { apiFetch } from '@/lib/web/api-client';
import { showToast } from '@/lib/web/toast-store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Modal } from '@/components/modal';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import type { DictOption } from '@/lib/domain/types';

const CATEGORY_LABELS: Record<string, string> = {
  trip_support_type: '外出·支持类型',
  trip_industry: '外出·行业',
  trip_product: '外出·产品',
  bidding_category: '招投标·类别',
  bidding_completion: '招投标·完成情况',
  demand_type: '建设申请·需求类型',
  industry_category: '行业类别',
  school_level: '学校层级',
  build_major: '建设专业',
};

function categoryLabel(cat: string): string {
  return CATEGORY_LABELS[cat] ?? cat;
}

interface EditDraft {
  value: string;
  aliases: string;
  sortOrder: number;
  active: boolean;
}

function toDraft(opt: DictOption): EditDraft {
  return {
    value: opt.value,
    aliases: opt.aliases.join('、'),
    sortOrder: opt.sortOrder,
    active: opt.active,
  };
}

function parseAliases(text: string): string[] {
  return Array.from(
    new Set(
      text
        .split(/[、,，\n\r\t]+/)
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  );
}

function errMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

export function DictAdminView() {
  const [rows, setRows] = useState<DictOption[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState<string>('all');
  const [keyword, setKeyword] = useState('');
  const [includeInactive, setIncludeInactive] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);

  const [editing, setEditing] = useState<DictOption | null>(null);
  const [draft, setDraft] = useState<EditDraft | null>(null);
  const [creating, setCreating] = useState(false);
  const [createDraft, setCreateDraft] = useState({
    category: '',
    value: '',
    aliases: '',
    sortOrder: 0,
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<DictOption[]>('/api/dict');
      setRows(data);
    } catch (err) {
      showToast(errMessage(err, '加载字典失败'), { kind: 'error' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const categories = useMemo(() => {
    if (!rows) return [];
    const set = new Set<string>();
    for (const r of rows) set.add(r.category);
    return Array.from(set).sort();
  }, [rows]);

  const filtered = useMemo(() => {
    if (!rows) return [];
    const kw = keyword.trim().toLowerCase();
    return rows.filter((r) => {
      if (category !== 'all' && r.category !== category) return false;
      if (!includeInactive && !r.active) return false;
      if (!kw) return true;
      if (r.value.toLowerCase().includes(kw)) return true;
      return r.aliases.some((a) => a.toLowerCase().includes(kw));
    });
  }, [rows, category, keyword, includeInactive]);

  const counts = useMemo(() => {
    const map = new Map<string, { total: number; inactive: number }>();
    if (!rows) return map;
    for (const r of rows) {
      const cur = map.get(r.category) ?? { total: 0, inactive: 0 };
      cur.total += 1;
      if (!r.active) cur.inactive += 1;
      map.set(r.category, cur);
    }
    return map;
  }, [rows]);

  const openEdit = useCallback((opt: DictOption) => {
    setEditing(opt);
    setDraft(toDraft(opt));
  }, []);

  const closeEdit = useCallback(() => {
    setEditing(null);
    setDraft(null);
  }, []);

  const saveEdit = useCallback(async () => {
    if (!editing || !draft) return;
    if (!draft.value.trim()) {
      showToast('字典值不能为空', { kind: 'error' });
      return;
    }
    setSavingId(editing.id);
    try {
      const updated = await apiFetch<DictOption>(`/api/dict/${editing.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          value: draft.value.trim(),
          aliases: parseAliases(draft.aliases),
          sortOrder: Number(draft.sortOrder) || 0,
          active: draft.active,
        }),
      });
      setRows((prev) => (prev ? prev.map((r) => (r.id === updated.id ? updated : r)) : prev));
      showToast('已保存', { kind: 'success' });
      closeEdit();
    } catch (err) {
      showToast(errMessage(err, '保存失败'), { kind: 'error' });
    } finally {
      setSavingId(null);
    }
  }, [editing, draft, closeEdit]);

  const toggleActive = useCallback(async (opt: DictOption, active: boolean) => {
    try {
      const updated = await apiFetch<DictOption>(`/api/dict/${opt.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ active }),
      });
      setRows((prev) => (prev ? prev.map((r) => (r.id === updated.id ? updated : r)) : prev));
      showToast(active ? '已启用' : '已停用', { kind: 'success' });
    } catch (err) {
      showToast(errMessage(err, '更新失败'), { kind: 'error' });
    }
  }, []);

  const submitCreate = useCallback(async () => {
    if (!createDraft.category.trim() || !createDraft.value.trim()) {
      showToast('分类和字典值不能为空', { kind: 'error' });
      return;
    }
    setSavingId('__new__');
    try {
      const created = await apiFetch<DictOption>('/api/dict/create', {
        method: 'POST',
        body: JSON.stringify({
          category: createDraft.category.trim(),
          value: createDraft.value.trim(),
          aliases: parseAliases(createDraft.aliases),
          sortOrder: Number(createDraft.sortOrder) || 0,
        }),
      });
      setRows((prev) => (prev ? [...prev, created] : [created]));
      showToast('已新增', { kind: 'success' });
      setCreating(false);
      setCategory(created.category);
      setCreateDraft({ category: created.category, value: '', aliases: '', sortOrder: 0 });
    } catch (err) {
      showToast(errMessage(err, '新增失败'), { kind: 'error' });
    } finally {
      setSavingId(null);
    }
  }, [createDraft]);

  return (
    <div className="space-y-5">
      <PageHeader
        icon={<BookMarked className="h-4 w-4" />}
        title="字典管理"
        subtitle="维护跨业务表的标准枚举值（行业、需求类型、产品、学校层级等）。超星推送未命中的值会自动登记，可在此合并别名、重命名、停用。"
        breadcrumb={[{ label: '系统' }, { label: '字典管理' }]}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={load} disabled={loading}>
              <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
              刷新
            </Button>
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus className="h-3.5 w-3.5" />
              新增字典值
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[220px_1fr]">
        <aside className="rounded-md border border-border bg-card">
          <div className="border-b border-border px-3 py-2">
            <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              分类
            </div>
          </div>
          <div className="max-h-[60vh] overflow-y-auto p-1.5">
            <button
              type="button"
              onClick={() => setCategory('all')}
              className={cn(
                'flex w-full items-center justify-between rounded px-2.5 py-1.5 text-left text-sm transition',
                category === 'all'
                  ? 'bg-brand-muted text-brand'
                  : 'text-foreground hover:bg-muted/60',
              )}
            >
              <span>全部分类</span>
              <span className="font-mono text-xs text-muted-foreground">{rows?.length ?? 0}</span>
            </button>
            {categories.map((cat) => {
              const c = counts.get(cat);
              const active = category === cat;
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setCategory(cat)}
                  className={cn(
                    'flex w-full items-center justify-between rounded px-2.5 py-1.5 text-left text-sm transition',
                    active ? 'bg-brand-muted text-brand' : 'text-foreground hover:bg-muted/60',
                  )}
                >
                  <span className="truncate">{categoryLabel(cat)}</span>
                  <span className="ml-2 shrink-0 font-mono text-xs text-muted-foreground">
                    {c?.total ?? 0}
                  </span>
                </button>
              );
            })}
          </div>
        </aside>

        <section className="min-w-0 space-y-3">
          <div className="rounded-md border border-border bg-card p-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  placeholder="搜索字典值 / 别名"
                  className="h-8 w-60 pl-8"
                />
              </div>
              <label className="flex cursor-pointer select-none items-center gap-2 text-xs text-muted-foreground">
                <Switch checked={includeInactive} onChange={setIncludeInactive} />
                显示已停用
              </label>
              <div className="ml-auto text-[11px] text-muted-foreground">
                共 <span className="font-mono text-foreground">{filtered.length}</span> 条
              </div>
            </div>
          </div>

          {loading || !rows ? (
            <div className="divide-y divide-border rounded-md border border-border bg-card">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-[58px] animate-pulse px-5 py-4">
                  <div className="h-3 w-40 rounded bg-muted" />
                  <div className="mt-2 h-2 w-64 rounded bg-muted/70" />
                </div>
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="rounded-md border border-dashed border-border bg-card py-16 text-center text-sm text-muted-foreground">
              <Tag className="mx-auto mb-2 h-7 w-7 text-muted-foreground/50" />
              当前筛选条件下暂无字典值
            </div>
          ) : (
            <div className="overflow-hidden rounded-md border border-border bg-card">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                    <th className="px-4 py-2 font-medium">字典值</th>
                    <th className="px-4 py-2 font-medium">别名</th>
                    <th className="w-20 px-4 py-2 font-medium">排序</th>
                    <th className="w-24 px-4 py-2 font-medium">来源</th>
                    <th className="w-20 px-4 py-2 text-right font-medium">启用</th>
                    <th className="w-20 px-4 py-2 text-right font-medium">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filtered.map((opt) => (
                    <tr key={opt.id} className={cn('transition hover:bg-muted/30', !opt.active && 'opacity-55')}>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-foreground">{opt.value}</span>
                          {category === 'all' && (
                            <Badge tone="neutral">{categoryLabel(opt.category)}</Badge>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-2.5">
                        {opt.aliases.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {opt.aliases.map((a) => (
                              <span
                                key={a}
                                className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground"
                              >
                                {a}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground/60">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">
                        {opt.sortOrder}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="font-mono text-[11px] text-muted-foreground">
                          {opt.source}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <Switch
                          checked={opt.active}
                          onChange={(v) => toggleActive(opt, v)}
                          className="ml-auto"
                          aria-label={opt.active ? '停用' : '启用'}
                        />
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2"
                          onClick={() => openEdit(opt)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                          编辑
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      <Modal
        open={!!editing}
        onClose={closeEdit}
        title="编辑字典值"
        description="修改标准值、别名与排序。别名用于把超星推送的不同写法归一到该值。"
        size="md"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={closeEdit}>
              取消
            </Button>
            <Button onClick={saveEdit} disabled={savingId === editing?.id}>
              <Save className="h-3.5 w-3.5" />
              保存
            </Button>
          </div>
        }
      >
        {editing && draft && (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>所属分类</Label>
              <Input value={categoryLabel(editing.category)} disabled />
            </div>
            <div className="space-y-1.5">
              <Label>标准值</Label>
              <Input
                value={draft.value}
                onChange={(e) => setDraft({ ...draft, value: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>别名（用顿号/逗号分隔）</Label>
              <Input
                value={draft.aliases}
                onChange={(e) => setDraft({ ...draft, aliases: e.target.value })}
                placeholder="如：教务（本科）、本科教务"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>排序权重</Label>
                <Input
                  type="number"
                  value={draft.sortOrder}
                  onChange={(e) => setDraft({ ...draft, sortOrder: Number(e.target.value) })}
                />
              </div>
              <div className="flex items-end justify-between pb-1.5">
                <Label>启用</Label>
                <Switch checked={draft.active} onChange={(v) => setDraft({ ...draft, active: v })} />
              </div>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title="新增字典值"
        description="新增一条标准枚举。可选择已有分类，或输入新分类标识。"
        size="md"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setCreating(false)}>
              <X className="h-3.5 w-3.5" />
              取消
            </Button>
            <Button onClick={submitCreate} disabled={savingId === '__new__'}>
              <Plus className="h-3.5 w-3.5" />
              新增
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>所属分类</Label>
            {categories.length > 0 && (
              <Select
                value={createDraft.category}
                onValueChange={(v) => setCreateDraft({ ...createDraft, category: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="选择已有分类（可再在下方修改）" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((c) => (
                    <SelectItem key={c} value={c}>
                      {categoryLabel(c)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Input
              value={createDraft.category}
              onChange={(e) => setCreateDraft({ ...createDraft, category: e.target.value })}
              placeholder="分类标识，如 trip_support_type"
            />
          </div>
          <div className="space-y-1.5">
            <Label>标准值</Label>
            <Input
              value={createDraft.value}
              onChange={(e) => setCreateDraft({ ...createDraft, value: e.target.value })}
              placeholder="如：教务（本科）"
            />
          </div>
          <div className="space-y-1.5">
            <Label>别名（可选）</Label>
            <Input
              value={createDraft.aliases}
              onChange={(e) => setCreateDraft({ ...createDraft, aliases: e.target.value })}
              placeholder="用顿号/逗号分隔"
            />
          </div>
        </div>
      </Modal>
    </div>
  );
}
