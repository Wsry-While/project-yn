'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  X,
  Loader2,
  Image as ImageIcon,
  CheckCircle2,
  AlertTriangle,
  FileDown,
  ChevronLeft,
  ChevronRight,
  Pencil,
  Eye,
  Ban,
  Layers,
  RefreshCw,
  GripVertical,
  Check,
  Plus,
  XCircle,
} from 'lucide-react';
import { apiFetch, apiFetchSSE } from '@/lib/web/api-client';
import { showToast } from '@/lib/web/toast-store';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

/** 与后端 ScreenshotGuide 结构对齐 */
export interface GuideReference {
  assetId: string;
  storagePath: string | null;
  exampleId: string;
  visionNote: string | null;
  evidenceElements: string[] | null;
  confidence: number | null;
  sourceRecordId: string | null;
  sourceProjectName?: string | null;
}

/**
 * 参考来源候选（按组展示）。图片虽然按「整组/散图」来源分组呈现，
 * 但允许用户跨组勾选任意多张，并可对已选图拖动排序（导出按此顺序）。
 */
export interface ReferenceSource {
  id: string;
  kind: 'group' | 'loose';
  title: string;
  imageCount: number;
  sourceProjectName: string | null;
  refs: GuideReference[];
}

export interface GuideItem {
  itemId: string;
  seq: number;
  title: string;
  systemModule: string | null;
  requirement: string;
  score: number | null;
  mustCapture: boolean;
  /** 当前生效参考图（= selectedAssetIds 按序反查候选池），界面预览与导出都用它 */
  references: GuideReference[];
  /** 用户勾选的参考图 assetId 有序列表（可跨组、可排序） */
  selectedAssetIds: string[];
  referenceGroupTitle?: string | null;
  referenceSources?: ReferenceSource[];
  instruction: string;
  suggestedFileName: string;
  status: 'pending' | 'ready' | 'na';
}

export interface ScreenshotGuide {
  recordId: string;
  projectName: string;
  schoolName: string | null;
  generatedAt: string;
  kbVersion: string | null;
  items: GuideItem[];
  totalScreenshots: number;
  matchedCount: number;
  unmatchedCount: number;
}

interface Props {
  open: boolean;
  recordId: string;
  onClose: () => void;
  /** 导出 Word，由父组件拼接下载链接并触发下载 */
  onExport: (guide: ScreenshotGuide) => void;
  exporting?: boolean;
}

type ItemStatus = GuideItem['status'];

const STATUS_META: Record<ItemStatus, { label: string; tone: string; icon: typeof CheckCircle2 }> = {
  ready: { label: '可截图', tone: 'text-status-success', icon: CheckCircle2 },
  pending: { label: '待补充', tone: 'text-status-warning', icon: AlertTriangle },
  na: { label: '本项无', tone: 'text-muted-foreground', icon: Ban },
};

/** 把候选池按 assetId 展开成索引 */
function buildPool(item: GuideItem): Map<string, { ref: GuideReference; source: ReferenceSource }> {
  const pool = new Map<string, { ref: GuideReference; source: ReferenceSource }>();
  for (const source of item.referenceSources ?? []) {
    for (const ref of source.refs) {
      if (!pool.has(ref.assetId)) pool.set(ref.assetId, { ref, source });
    }
  }
  return pool;
}

/** 根据 selectedAssetIds + 候选池重算 references（保序、去重、剔除失效） */
function resolveReferences(item: GuideItem, assetIds: string[]): GuideReference[] {
  const pool = buildPool(item);
  const seen = new Set<string>();
  const out: GuideReference[] = [];
  for (const id of assetIds) {
    if (seen.has(id)) continue;
    const hit = pool.get(id);
    if (hit) {
      seen.add(id);
      out.push(hit.ref);
    }
  }
  return out;
}

export function ScreenshotGuideDialog({ open, recordId, onClose, onExport, exporting }: Props) {
  const [loading, setLoading] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [progress, setProgress] = useState<{ step: string; detail: string; percent: number }>({
    step: '',
    detail: '',
    percent: 0,
  });
  const [guide, setGuide] = useState<ScreenshotGuide | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [refIndex, setRefIndex] = useState(0);
  /** 用户手工编辑过说明的项（仅这些项持久化 instructionOverride） */
  const editedInstructions = useRef<Set<string>>(new Set());
  /** 拖拽排序：当前拖动的 assetId */
  const [dragAsset, setDragAsset] = useState<string | null>(null);
  const skipSave = useRef(true);
  const guideRef = useRef<ScreenshotGuide | null>(null);
  guideRef.current = guide;

  const activeItem = useMemo(
    () => guide?.items.find((i) => i.itemId === activeId) ?? null,
    [guide, activeId],
  );

  /** 组装待持久化的人工决策合集 */
  const buildSelections = useCallback((g: ScreenshotGuide) => {
    const selections: Record<
      string,
      { status: ItemStatus; selectedAssetIds: string[]; instructionOverride?: string }
    > = {};
    for (const it of g.items) {
      selections[it.itemId] = {
        status: it.status,
        selectedAssetIds: it.selectedAssetIds,
        ...(editedInstructions.current.has(it.itemId)
          ? { instructionOverride: it.instruction }
          : {}),
      };
    }
    return selections;
  }, []);

  /** 落库（keepalive 以便关闭时也能发出） */
  const persist = useCallback(
    async (g: ScreenshotGuide, keepalive = false) => {
      try {
        await fetch(`/api/bidding-screenshots/${g.recordId}/screenshot-guide`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ selections: buildSelections(g) }),
          keepalive,
        });
      } catch {
        // 静默：自动保存失败不打断操作
      }
    },
    [buildSelections],
  );

  /** SSE 生成（force=true 为重新匹配，合并历史勾选） */
  const runGenerate = useCallback(
    (force: boolean) => {
      setLoading(true);
      setRegenerating(force);
      setGuide(null);
      setProgress({ step: 'load', detail: force ? '重新匹配知识库…' : '开始生成…', percent: 0 });

      const url = `/api/bidding-screenshots/${recordId}/screenshot-guide${force ? '?force=1' : ''}`;
      const cancel = apiFetchSSE(
        url,
        {},
        {
          onDelta: () => {},
          onStep: (s) => {
            setProgress({
              step: String(s.step ?? s.phase ?? ''),
              detail: String(s.detail ?? s.message ?? ''),
              percent: typeof s.percent === 'number' ? s.percent : 0,
            });
          },
          onDone: (evt) => {
            const g = (evt as { guide?: ScreenshotGuide } | undefined)?.guide;
            if (g) {
              skipSave.current = true;
              setGuide(g);
              setActiveId(g.items[0]?.itemId ?? null);
              if (force) showToast('已重新匹配知识库，并保留你的勾选与状态', { kind: 'success' });
            }
            setLoading(false);
            setRegenerating(false);
          },
          onError: (err) => {
            setLoading(false);
            setRegenerating(false);
            showToast(err.message || '生成截图指导书失败', { kind: 'error' });
          },
        },
      );
      return cancel;
    },
    [recordId],
  );

  // 打开弹窗：优先复用已保存指导书（GET），无则首次全量生成（SSE）
  useEffect(() => {
    if (!open || !recordId) return;
    let cancelled = false;
    let cancelSse: (() => void) | null = null;
    skipSave.current = true;
    editedInstructions.current = new Set();
    setGuide(null);
    setActiveId(null);

    (async () => {
      try {
        const data = await apiFetch<{ saved: boolean; guide?: ScreenshotGuide }>(
          `/api/bidding-screenshots/${recordId}/screenshot-guide`,
        );
        if (cancelled) return;
        if (data.saved && data.guide) {
          // 二次进入：直接复用上次结果（含勾选/状态/说明）
          setGuide(data.guide);
          setActiveId(data.guide.items[0]?.itemId ?? null);
          // 已有说明视为用户可能编辑过，重算时保留
          for (const it of data.guide.items) {
            if (it.instruction) editedInstructions.current.add(it.itemId);
          }
        } else {
          // 首次进入：走知识库搜索 + 生成
          cancelSse = runGenerate(false);
        }
      } catch {
        if (!cancelled) cancelSse = runGenerate(false);
      }
    })();

    return () => {
      cancelled = true;
      cancelSse?.();
    };
  }, [open, recordId, runGenerate]);

  // 自动保存（防抖）
  useEffect(() => {
    if (!guide) return;
    if (skipSave.current) {
      skipSave.current = false;
      return;
    }
    const t = setTimeout(() => {
      persist(guide);
    }, 800);
    return () => clearTimeout(t);
  }, [guide, persist]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        handleClose();
      }
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, onClose]);

  // 关闭前尽力落盘一次
  const handleClose = () => {
    if (guideRef.current) persist(guideRef.current, true);
    onClose();
  };

  useEffect(() => {
    setRefIndex(0);
    setEditing(false);
  }, [activeId]);

  if (!open) return null;

  const updateItem = (itemId: string, patch: Partial<GuideItem>) => {
    setGuide((prev) =>
      prev
        ? {
            ...prev,
            items: prev.items.map((it) => (it.itemId === itemId ? { ...it, ...patch } : it)),
          }
        : prev,
    );
  };

  const cycleStatus = (item: GuideItem) => {
    const order: ItemStatus[] = ['ready', 'pending', 'na'];
    const next = order[(order.indexOf(item.status) + 1) % order.length];
    updateItem(item.itemId, { status: next });
  };

  const saveDraft = () => {
    if (!activeItem) return;
    editedInstructions.current.add(activeItem.itemId);
    updateItem(activeItem.itemId, { instruction: draft });
    setEditing(false);
  };

  /** 跨组勾选/取消单张图 */
  const toggleAsset = (item: GuideItem, assetId: string) => {
    const has = item.selectedAssetIds.includes(assetId);
    let nextIds: string[];
    if (has) {
      nextIds = item.selectedAssetIds.filter((id) => id !== assetId);
    } else {
      nextIds = [...item.selectedAssetIds, assetId];
    }
    const refs = resolveReferences(item, nextIds);
    const firstSrc = nextIds.length
      ? (buildPool(item).get(nextIds[0])?.source ?? null)
      : null;
    updateItem(item.itemId, {
      selectedAssetIds: nextIds,
      references: refs,
      referenceGroupTitle: firstSrc?.kind === 'group' ? firstSrc.title : null,
    });
    setRefIndex(0);
  };

  /** 整组快速勾选/取消 */
  const toggleSourceAll = (item: GuideItem, source: ReferenceSource) => {
    const selected = new Set(item.selectedAssetIds);
    const allIn = source.refs.every((r) => selected.has(r.assetId));
    if (allIn) {
      for (const r of source.refs) selected.delete(r.assetId);
    } else {
      for (const r of source.refs) selected.add(r.assetId);
    }
    // 保持 references 顺序：按来源顺序重建（已有的保留相对位置，新选追加）
    const ordered: string[] = [];
    for (const src of item.referenceSources ?? []) {
      for (const r of src.refs) {
        if (selected.has(r.assetId)) ordered.push(r.assetId);
      }
    }
    updateItem(item.itemId, {
      selectedAssetIds: ordered,
      references: resolveReferences(item, ordered),
      referenceGroupTitle: null,
    });
    setRefIndex(0);
  };

  /** 拖拽排序：把 dragAsset 放到 targetAsset 位置 */
  const reorder = (item: GuideItem, targetAsset: string) => {
    if (!dragAsset || dragAsset === targetAsset) return;
    const ids = [...item.selectedAssetIds];
    const from = ids.indexOf(dragAsset);
    const to = ids.indexOf(targetAsset);
    if (from < 0 || to < 0) return;
    ids.splice(from, 1);
    ids.splice(to, 0, dragAsset);
    updateItem(item.itemId, {
      selectedAssetIds: ids,
      references: resolveReferences(item, ids),
    });
  };

  const readyCount = guide?.items.filter((i) => i.status === 'ready').length ?? 0;
  const pendingCount = guide?.items.filter((i) => i.status === 'pending').length ?? 0;
  const naCount = guide?.items.filter((i) => i.status === 'na').length ?? 0;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[95] flex items-stretch justify-center bg-black/50 p-2 sm:p-4"
    >
      <div className="animate-fade-in-up relative flex w-full max-w-[1400px] flex-col overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-[0_24px_60px_rgba(0,0,0,0.4)]">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-3">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-base font-semibold">
              <ImageIcon className="h-4 w-4 text-brand" />
              截图作业指导书
            </h2>
            <p className="mt-0.5 truncate text-sm text-muted-foreground">
              {guide
                ? `${guide.projectName}${guide.schoolName ? ` · ${guide.schoolName}` : ''} · 共 ${guide.items.length} 项（必截 ${guide.totalScreenshots}） · 已匹配参考图 ${guide.matchedCount} 项${guide.kbVersion ? ` · 知识库 ${guide.kbVersion}` : ''}`
                : '正在根据评分项与知识库生成作业说明…'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {guide && (
              <Button
                size="sm"
                variant="outline"
                disabled={loading || regenerating || exporting}
                onClick={() => runGenerate(true)}
                title="重新搜索知识库，保留你的勾选与状态"
              >
                {regenerating ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                重新匹配知识库
              </Button>
            )}
            {guide && (
              <Button
                size="sm"
                variant="default"
                disabled={exporting}
                onClick={() => guide && onExport(guide)}
              >
                {exporting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <FileDown className="h-4 w-4" />
                )}
                导出 Word
              </Button>
            )}
            <button
              type="button"
              aria-label="关闭"
              onClick={handleClose}
              className="rounded-md p-1.5 text-muted-foreground transition hover:bg-accent hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {loading ? (
          <LoadingState progress={progress} />
        ) : !guide ? (
          <div className="flex flex-1 items-center justify-center p-10 text-sm text-muted-foreground">
            生成失败，请关闭后重试。
          </div>
        ) : (
          <div className="flex min-h-0 flex-1">
            {/* Left: item list */}
            <aside className="flex w-72 shrink-0 flex-col border-r border-border bg-muted/20">
              <div className="flex items-center gap-2 border-b border-border px-3 py-2 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3 text-status-success" />
                  {readyCount}
                </span>
                <span className="inline-flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3 text-status-warning" />
                  {pendingCount}
                </span>
                <span className="inline-flex items-center gap-1">
                  <Ban className="h-3 w-3" />
                  {naCount}
                </span>
                <span className="ml-auto">点击切换</span>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto py-1">
                {guide.items.map((item) => {
                  const meta = STATUS_META[item.status];
                  const Icon = meta.icon;
                  const active = item.itemId === activeId;
                  return (
                    <button
                      key={item.itemId}
                      type="button"
                      onClick={() => setActiveId(item.itemId)}
                      className={cn(
                        'flex w-full items-start gap-2 px-3 py-2 text-left text-sm transition',
                        active ? 'bg-brand/10 text-foreground' : 'hover:bg-accent',
                      )}
                    >
                      <span className="mt-0.5 w-6 shrink-0 font-mono text-xs text-muted-foreground">
                        {String(item.seq).padStart(2, '0')}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="line-clamp-2 block leading-snug">{item.title}</span>
                        <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Icon className={cn('h-3 w-3', meta.tone)} />
                          {meta.label}
                          {item.selectedAssetIds.length > 0 && (
                            <span className="text-status-success">· {item.selectedAssetIds.length} 图</span>
                          )}
                          {item.score != null && <span>· {item.score}分</span>}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </aside>

            {/* Right: detail */}
            {activeItem && (
              <section className="flex min-w-0 flex-1 flex-col">
                <div className="border-b border-border px-6 py-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span className="font-mono">#{String(activeItem.seq).padStart(2, '0')}</span>
                        {activeItem.systemModule && (
                          <span className="rounded bg-muted px-1.5 py-0.5">{activeItem.systemModule}</span>
                        )}
                        {activeItem.score != null && <span>{activeItem.score} 分</span>}
                        {!activeItem.mustCapture && (
                          <span className="text-muted-foreground">（一般参数）</span>
                        )}
                      </div>
                      <h3 className="mt-1 text-lg font-semibold leading-snug">{activeItem.title}</h3>
                      <p className="mt-1 max-h-24 overflow-y-auto rounded bg-muted/40 p-2 text-sm text-muted-foreground">
                        {activeItem.requirement}
                      </p>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => cycleStatus(activeItem)}>
                      {(() => {
                        const meta = STATUS_META[activeItem.status];
                        const Icon = meta.icon;
                        return (
                          <>
                            <Icon className={cn('h-4 w-4', meta.tone)} />
                            {meta.label}
                          </>
                        );
                      })()}
                    </Button>
                  </div>
                </div>

                <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-2">
                  {/* Reference images */}
                  <div className="flex min-h-0 flex-col border-b border-border lg:border-b-0 lg:border-r">
                    <div className="flex items-center justify-between border-b border-border px-4 py-2 text-sm">
                      <span className="font-medium">
                        历史参考截图
                        <span className="ml-2 text-xs font-normal text-muted-foreground">
                          已选 {activeItem.selectedAssetIds.length} 张 · 可跨组勾选、拖动排序
                        </span>
                      </span>
                      {activeItem.references.length > 1 && (
                        <div className="flex items-center gap-1">
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            onClick={() =>
                              setRefIndex((i) => (i - 1 + activeItem.references.length) % activeItem.references.length)
                            }
                          >
                            <ChevronLeft className="h-4 w-4" />
                          </Button>
                          <span className="font-mono text-xs text-muted-foreground">
                            {refIndex + 1}/{activeItem.references.length}
                          </span>
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            onClick={() => setRefIndex((i) => (i + 1) % activeItem.references.length)}
                          >
                            <ChevronRight className="h-4 w-4" />
                          </Button>
                        </div>
                      )}
                    </div>
                    <div className="min-h-0 flex-1 overflow-auto p-4">
                      {(!activeItem.referenceSources || activeItem.referenceSources.length === 0) &&
                      activeItem.references.length === 0 ? (
                        <div className="flex h-full min-h-[200px] flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
                          <ImageIcon className="h-8 w-8 opacity-40" />
                          知识库暂无此项的历史参考图
                          <span className="text-xs">请按通用规范截图或标记「待补充」</span>
                        </div>
                      ) : (
                        <div className="space-y-4">
                          {/* 大图预览（当前浏览的已选图） */}
                          {activeItem.references.length > 0 ? (
                            <ReferenceViewer reference={activeItem.references[Math.min(refIndex, activeItem.references.length - 1)]} />
                          ) : (
                            <div className="flex min-h-[160px] flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border text-sm text-muted-foreground">
                              <Ban className="h-6 w-6 opacity-40" />
                              尚未勾选参考图，请从下方候选中选择
                            </div>
                          )}

                          {/* 已选截图（可拖动排序 / 移除） */}
                          {activeItem.references.length > 0 && (
                            <div className="rounded-md border border-brand/20 bg-brand/5 p-2.5">
                              <p className="mb-2 flex items-center gap-1 text-xs font-medium text-brand">
                                <Layers className="h-3.5 w-3.5" />
                                已选截图（{activeItem.references.length}）· 拖动可调整导出顺序
                              </p>
                              <div className="flex flex-wrap gap-2">
                                {activeItem.references.map((ref, idx) => (
                                  <div
                                    key={ref.assetId}
                                    draggable
                                    onDragStart={() => setDragAsset(ref.assetId)}
                                    onDragOver={(e) => e.preventDefault()}
                                    onDrop={() => reorder(activeItem, ref.assetId)}
                                    onDragEnd={() => setDragAsset(null)}
                                    className={cn(
                                      'group relative w-20 shrink-0 cursor-grab overflow-hidden rounded border bg-card active:cursor-grabbing',
                                      dragAsset === ref.assetId
                                        ? 'border-brand opacity-50'
                                        : 'border-border hover:border-brand/50',
                                    )}
                                  >
                                    <div className="flex items-center justify-between bg-muted/60 px-1 py-0.5 text-[10px] text-muted-foreground">
                                      <GripVertical className="h-3 w-3" />
                                      <span className="font-mono">#{idx + 1}</span>
                                    </div>
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img
                                      src={`/api/files/preview/${ref.assetId}`}
                                      alt=""
                                      className="h-14 w-full object-cover"
                                      onClick={() => setRefIndex(idx)}
                                    />
                                    <button
                                      type="button"
                                      aria-label="移除"
                                      onClick={() => toggleAsset(activeItem, ref.assetId)}
                                      className="absolute right-0.5 top-5 rounded-full bg-background/80 text-muted-foreground opacity-0 transition hover:text-destructive group-hover:opacity-100"
                                    >
                                      <XCircle className="h-3.5 w-3.5" />
                                    </button>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* 候选参考图（按来源分组，可跨组勾选） */}
                          <div className="space-y-2">
                            <p className="text-xs font-medium text-muted-foreground">
                              候选参考图（按知识库来源分组，点击图片即可加入/移出）
                            </p>
                            {(activeItem.referenceSources ?? []).map((s) => {
                              const allIn = s.refs.every((r) =>
                                activeItem.selectedAssetIds.includes(r.assetId),
                              );
                              return (
                                <div key={s.id} className="rounded-md border border-border bg-muted/20">
                                  <div className="flex items-center justify-between gap-2 border-b border-border px-2.5 py-1.5">
                                    <div className="flex min-w-0 items-center gap-1.5 text-xs">
                                      <span
                                        className={cn(
                                          'rounded px-1 py-px text-[10px]',
                                          s.kind === 'group'
                                            ? 'bg-brand/15 text-brand'
                                            : 'bg-muted text-muted-foreground',
                                        )}
                                      >
                                        {s.kind === 'group' ? '整组' : '散图'}
                                      </span>
                                      <span className="line-clamp-1 break-all">{s.title}</span>
                                      <span className="shrink-0 text-muted-foreground">
                                        {s.imageCount} 张{s.sourceProjectName ? ` · ${s.sourceProjectName}` : ''}
                                      </span>
                                    </div>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="h-6 shrink-0 px-2 text-xs"
                                      onClick={() => toggleSourceAll(activeItem, s)}
                                    >
                                      {allIn ? '取消整组' : '全选整组'}
                                    </Button>
                                  </div>
                                  <div className="grid grid-cols-2 gap-1.5 p-2 sm:grid-cols-3">
                                    {s.refs.map((ref) => {
                                      const checked = activeItem.selectedAssetIds.includes(ref.assetId);
                                      return (
                                        <button
                                          key={ref.assetId}
                                          type="button"
                                          onClick={() => toggleAsset(activeItem, ref.assetId)}
                                          className={cn(
                                            'group relative overflow-hidden rounded border text-left transition',
                                            checked
                                              ? 'border-brand ring-1 ring-brand'
                                              : 'border-border hover:border-brand/40',
                                          )}
                                          title={ref.visionNote ?? ''}
                                        >
                                          {/* eslint-disable-next-line @next/next/no-img-element */}
                                          <img
                                            src={`/api/files/preview/${ref.assetId}`}
                                            alt=""
                                            className="h-16 w-full object-cover"
                                          />
                                          <span
                                            className={cn(
                                              'absolute left-1 top-1 flex h-4 w-4 items-center justify-center rounded-full border',
                                              checked
                                                ? 'border-brand bg-brand text-white'
                                                : 'border-white/70 bg-black/40 text-transparent',
                                            )}
                                          >
                                            {checked ? <Check className="h-3 w-3" /> : <Plus className="h-3 w-3 text-white" />}
                                          </span>
                                          {ref.visionNote && (
                                            <span className="block truncate bg-background/85 px-1 py-0.5 text-[10px] text-muted-foreground">
                                              {ref.visionNote}
                                            </span>
                                          )}
                                        </button>
                                      );
                                    })}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Instruction editor */}
                  <div className="flex min-h-0 flex-col">
                    <div className="flex items-center justify-between border-b border-border px-4 py-2 text-sm">
                      <span className="font-medium">作业说明</span>
                      <div className="flex items-center gap-2">
                        {editing ? (
                          <>
                            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                              取消
                            </Button>
                            <Button size="sm" variant="default" onClick={saveDraft}>
                              <CheckCircle2 className="h-4 w-4" /> 保存
                            </Button>
                          </>
                        ) : (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setDraft(activeItem.instruction);
                              setEditing(true);
                            }}
                          >
                            <Pencil className="h-4 w-4" /> 编辑
                          </Button>
                        )}
                      </div>
                    </div>
                    <div className="min-h-0 flex-1 overflow-auto p-4">
                      {editing ? (
                        <Textarea
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
                          className="min-h-[240px] resize-none font-mono text-sm leading-relaxed"
                          placeholder="写明到哪个菜单、截什么、如何证明满足要求…"
                        />
                      ) : (
                        <div className="whitespace-pre-wrap text-sm leading-relaxed">
                          {activeItem.instruction || (
                            <span className="text-muted-foreground">暂无说明，点击「编辑」补充。</span>
                          )}
                        </div>
                      )}
                      <div className="mt-4 rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
                        <div className="flex items-center gap-1.5 font-medium text-foreground">
                          <FileDown className="h-3.5 w-3.5" />
                          建议文件名
                        </div>
                        <p className="mt-1 font-mono">{activeItem.suggestedFileName}</p>
                      </div>
                    </div>
                  </div>
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ReferenceViewer({ reference }: { reference: GuideReference }) {
  const previewUrl = `/api/files/preview/${reference.assetId}`;
  const [broken, setBroken] = useState(false);
  return (
    <figure className="space-y-2">
      <a
        href={previewUrl}
        target="_blank"
        rel="noreferrer"
        className="block overflow-hidden rounded-md border border-border bg-muted/30"
      >
        {broken ? (
          <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
            <Eye className="mr-2 h-4 w-4" />
            预览不可用，点击新窗口打开
          </div>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={previewUrl}
            alt={reference.visionNote || '参考截图'}
            className="max-h-[420px] w-full object-contain"
            onError={() => setBroken(true)}
          />
        )}
      </a>
      {reference.visionNote && (
        <figcaption className="text-sm text-muted-foreground">
          {reference.visionNote.startsWith('图组第') ? null : (
            <span className="font-medium text-foreground">识别要点：</span>
          )}
          {reference.visionNote}
        </figcaption>
      )}
      {reference.evidenceElements && reference.evidenceElements.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {reference.evidenceElements.map((el, i) => (
            <span key={i} className="rounded bg-brand/10 px-1.5 py-0.5 text-xs text-brand">
              {el}
            </span>
          ))}
        </div>
      )}
      {reference.confidence != null && (
        <p className="text-xs text-muted-foreground">
          匹配置信度 {Math.round(reference.confidence * 100)}%
        </p>
      )}
    </figure>
  );
}

function LoadingState({
  progress,
}: {
  progress: { step: string; detail: string; percent: number };
}) {
  const STEP_LABEL: Record<string, string> = {
    load: '读取评分项',
    match: '匹配知识库',
    generate: 'AI 生成说明',
    done: '完成',
  };
  const pct = Math.min(100, Math.max(0, progress.percent));
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-5 p-10">
      <div className="relative flex h-16 w-16 items-center justify-center">
        <Loader2 className="h-12 w-12 animate-spin text-brand" />
      </div>
      <div className="w-full max-w-md space-y-2 text-center">
        <p className="text-sm font-medium">
          {STEP_LABEL[progress.step] ?? '生成中'}…
        </p>
        <p className="text-xs text-muted-foreground">{progress.detail}</p>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-brand transition-all duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    </div>
  );
}
