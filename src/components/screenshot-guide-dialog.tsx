'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  X,
  Loader2,
  Image as ImageIcon,
  CheckCircle2,
  AlertTriangle,
  FileDown,
  Ban,
  Pencil,
  Eye,
  Layers,
  RefreshCw,
  GripVertical,
  Check,
  Plus,
  XCircle,
  Search,
  Sparkles,
  PanelRightClose,
  PanelRightOpen,
  Images,
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
  references: GuideReference[];
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

/** 知识库图片搜索的单张结果（带所属图组上下文） */
interface KbImageHit {
  assetId: string;
  score: number;
  seqInGroup: number;
  group: {
    groupId: string;
    sectionTitle: string;
    imageCount: number;
    sourceRecordId: string;
    sourceProjectName: string | null;
    sourceSchool: string | null;
  };
}

interface Props {
  open: boolean;
  recordId: string;
  onClose: () => void;
  onExport: (guide: ScreenshotGuide) => void;
  exporting?: boolean;
}

type ItemStatus = GuideItem['status'];

const STATUS_META: Record<ItemStatus, { label: string; tone: string; icon: typeof CheckCircle2 }> = {
  ready: { label: '可截图', tone: 'text-status-success', icon: CheckCircle2 },
  pending: { label: '待补充', tone: 'text-status-warning', icon: AlertTriangle },
  na: { label: '本项无', tone: 'text-muted-foreground', icon: Ban },
};

function buildPool(item: GuideItem): Map<string, { ref: GuideReference; source: ReferenceSource }> {
  const pool = new Map<string, { ref: GuideReference; source: ReferenceSource }>();
  for (const source of item.referenceSources ?? []) {
    for (const ref of source.refs) {
      if (!pool.has(ref.assetId)) pool.set(ref.assetId, { ref, source });
    }
  }
  return pool;
}

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

function refFromHit(hit: KbImageHit, idx: number): GuideReference {
  return {
    assetId: hit.assetId,
    storagePath: null,
    exampleId: `manual-${hit.assetId}`,
    visionNote: `图组第 ${idx + 1} 张：${hit.group.sectionTitle}`,
    evidenceElements: [],
    confidence: null,
    sourceRecordId: hit.group.sourceRecordId,
    sourceProjectName: hit.group.sourceProjectName,
  };
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
  const [showInfo, setShowInfo] = useState(true);
  const [dragAsset, setDragAsset] = useState<string | null>(null);

  // 搜知识库
  const [searchInput, setSearchInput] = useState('');
  const [searchKeyword, setSearchKeyword] = useState('');
  const [hits, setHits] = useState<KbImageHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchedFor, setSearchedFor] = useState<string | null>(null);

  const editedInstructions = useRef<Set<string>>(new Set());
  const skipSave = useRef(true);
  const guideRef = useRef<ScreenshotGuide | null>(null);
  guideRef.current = guide;

  const activeItem = useMemo(
    () => guide?.items.find((i) => i.itemId === activeId) ?? null,
    [guide, activeId],
  );

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
        // 静默
      }
    },
    [buildSelections],
  );

  const runGenerate = useCallback(
    (force: boolean) => {
      setLoading(true);
      setRegenerating(force);
      setGuide(null);
      setHits([]);
      setSearchedFor(null);
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

  useEffect(() => {
    if (!open || !recordId) return;
    let cancelled = false;
    let cancelSse: (() => void) | null = null;
    skipSave.current = true;
    editedInstructions.current = new Set();
    setGuide(null);
    setActiveId(null);
    setHits([]);
    setSearchedFor(null);

    (async () => {
      try {
        const data = await apiFetch<{ saved: boolean; guide?: ScreenshotGuide }>(
          `/api/bidding-screenshots/${recordId}/screenshot-guide`,
        );
        if (cancelled) return;
        if (data.saved && data.guide) {
          setGuide(data.guide);
          setActiveId(data.guide.items[0]?.itemId ?? null);
          for (const it of data.guide.items) {
            if (it.instruction) editedInstructions.current.add(it.itemId);
          }
        } else {
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
    const t = setTimeout(() => persist(guide), 800);
    return () => clearTimeout(t);
  }, [guide, persist]);

  const handleClose = useCallback(() => {
    if (guideRef.current) persist(guideRef.current, true);
    onClose();
  }, [onClose, persist]);

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
  }, [open, handleClose]);

  useEffect(() => {
    setEditing(false);
  }, [activeId]);

  // 切换参数后，自动用参数标题搜一次知识库（用户可再手动改关键词）
  useEffect(() => {
    if (!activeItem) return;
    const kw = activeItem.title || '';
    setSearchInput(kw);
    void doSearch(kw);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  const updateItem = (itemId: string, patch: Partial<GuideItem>) => {
    setGuide((prev) =>
      prev
        ? { ...prev, items: prev.items.map((it) => (it.itemId === itemId ? { ...it, ...patch } : it)) }
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

  const doSearch = async (raw?: string) => {
    const kw = (raw ?? searchInput).trim();
    if (!kw) {
      showToast('请输入搜索关键词', { kind: 'info' });
      return;
    }
    setSearching(true);
    setSearchKeyword(kw);
    try {
      const data = await apiFetch<{ rows: KbImageHit[] }>('/api/bidding-screenshots/kb-images', {
        query: { keywords: kw, limit: 60 },
      });
      setHits(data.rows ?? []);
      setSearchedFor(kw);
    } catch (e) {
      showToast(e instanceof Error ? e.message : '搜索知识库失败', { kind: 'error' });
      setHits([]);
      setSearchedFor(kw);
    } finally {
      setSearching(false);
    }
  };

  /** 把搜索来源（整组/散图）并入候选池，返回更新后的 sources */
  const ensureSource = (
    item: GuideItem,
    source: ReferenceSource,
  ): ReferenceSource[] => {
    const sources = item.referenceSources ? [...item.referenceSources] : [];
    const existing = sources.find((s) => s.id === source.id);
    if (existing) return sources;
    sources.push(source);
    return sources;
  };

  /** 加入单张搜索结果图 */
  const addHitAsset = (item: GuideItem, hit: KbImageHit) => {
    if (item.selectedAssetIds.includes(hit.assetId)) {
      // 已选则取消
      toggleAsset(item, hit.assetId);
      return;
    }
    const ref = refFromHit(hit, hit.seqInGroup);
    // 若候选池里没有该图，用「搜知识库」散图来源承载（保证重开/重算不丢）
    let sources = item.referenceSources ?? [];
    if (!buildPool(item).has(hit.assetId)) {
      const manualId = 'manual:search';
      const manual = sources.find((s) => s.id === manualId);
      if (manual) {
        sources = sources.map((s) =>
          s.id === manualId ? { ...s, refs: [...s.refs, ref], imageCount: s.refs.length + 1 } : s,
        );
      } else {
        sources = [
          ...sources,
          { id: manualId, kind: 'loose', title: '搜知识库加入', imageCount: 1, sourceProjectName: null, refs: [ref] },
        ];
      }
    }
    const nextIds = [...item.selectedAssetIds, hit.assetId];
    const updated = { ...item, referenceSources: sources };
    updateItem(item.itemId, {
      referenceSources: sources,
      selectedAssetIds: nextIds,
      references: resolveReferences(updated, nextIds),
    });
  };

  /** 整组加入：把该图组在搜索结果里的所有图加入（若推荐来源里已有完整组则用其全部） */
  const addHitGroup = (item: GuideItem, groupId: string) => {
    const groupHits = hits
      .filter((h) => h.group.groupId === groupId)
      .sort((a, b) => a.seqInGroup - b.seqInGroup);
    if (!groupHits.length) return;
    const g = groupHits[0].group;

    let sources = item.referenceSources ? [...item.referenceSources] : [];
    const groupSourceId = `group:${groupId}`;
    let groupRefs: GuideReference[];
    const existingGroup = sources.find((s) => s.id === groupSourceId);
    if (existingGroup) {
      groupRefs = existingGroup.refs;
    } else {
      groupRefs = groupHits.map((h, i) => refFromHit(h, i));
      sources.push({
        id: groupSourceId,
        kind: 'group',
        title: g.sectionTitle,
        imageCount: g.imageCount,
        sourceProjectName: g.sourceProjectName,
        refs: groupRefs,
      });
    }

    const selected = new Set(item.selectedAssetIds);
    for (const r of groupRefs) selected.add(r.assetId);
    // 保持顺序：按来源顺序重建
    const ordered: string[] = [];
    for (const src of sources) {
      for (const r of src.refs) if (selected.has(r.assetId)) ordered.push(r.assetId);
    }
    const updated = { ...item, referenceSources: sources };
    updateItem(item.itemId, {
      referenceSources: sources,
      selectedAssetIds: ordered,
      references: resolveReferences(updated, ordered),
      referenceGroupTitle: g.sectionTitle,
    });
    showToast(`已整组加入 ${groupRefs.length} 张`, { kind: 'success' });
  };

  const toggleAsset = (item: GuideItem, assetId: string) => {
    const has = item.selectedAssetIds.includes(assetId);
    const nextIds = has
      ? item.selectedAssetIds.filter((id) => id !== assetId)
      : [...item.selectedAssetIds, assetId];
    const refs = resolveReferences(item, nextIds);
    const firstSrc = nextIds.length ? buildPool(item).get(nextIds[0])?.source ?? null : null;
    updateItem(item.itemId, {
      selectedAssetIds: nextIds,
      references: refs,
      referenceGroupTitle: firstSrc?.kind === 'group' ? firstSrc.title : null,
    });
  };

  const reorder = (item: GuideItem, targetAsset: string) => {
    if (!dragAsset || dragAsset === targetAsset) return;
    const ids = [...item.selectedAssetIds];
    const from = ids.indexOf(dragAsset);
    const to = ids.indexOf(targetAsset);
    if (from < 0 || to < 0) return;
    ids.splice(from, 1);
    ids.splice(to, 0, dragAsset);
    updateItem(item.itemId, { selectedAssetIds: ids, references: resolveReferences(item, ids) });
  };

  // 搜索结果按图组归并（保持相关度顺序），便于整组加入
  const hitGroups = useMemo(() => {
    const map = new Map<string, { hit: KbImageHit; items: KbImageHit[] }>();
    for (const h of hits) {
      const cur = map.get(h.group.groupId);
      if (cur) cur.items.push(h);
      else map.set(h.group.groupId, { hit: h, items: [h] });
    }
    return Array.from(map.values()).sort((a, b) => b.hit.score - a.hit.score);
  }, [hits]);

  // 推荐来源：排除「搜知识库加入」散图来源（它由已选区体现）
  const recommendSources = useMemo(
    () => (activeItem?.referenceSources ?? []).filter((s) => s.id !== 'manual:search'),
    [activeItem],
  );

  const readyCount = guide?.items.filter((i) => i.status === 'ready').length ?? 0;
  const pendingCount = guide?.items.filter((i) => i.status === 'pending').length ?? 0;
  const naCount = guide?.items.filter((i) => i.status === 'na').length ?? 0;

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[95] flex items-stretch justify-center bg-black/60 p-1.5 sm:p-3"
    >
      <div className="animate-fade-in-up relative flex h-full w-full max-w-[1560px] flex-col overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-[0_24px_60px_rgba(0,0,0,0.4)]">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-3">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-base font-semibold">
              <ImageIcon className="h-4 w-4 text-brand" />
              截图作业指导书
            </h2>
            <p className="mt-0.5 truncate text-sm text-muted-foreground">
              {guide
                ? `${guide.projectName}${guide.schoolName ? ` · ${guide.schoolName}` : ''} · 共 ${guide.items.length} 项 · 已匹配 ${guide.matchedCount} 项${guide.kbVersion ? ` · 知识库 ${guide.kbVersion}` : ''}`
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
                {regenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                重新匹配
              </Button>
            )}
            {guide && (
              <Button size="sm" variant="default" disabled={exporting} onClick={() => guide && onExport(guide)}>
                {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
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
        ) : !guide || !activeItem ? (
          <div className="flex flex-1 items-center justify-center p-10 text-sm text-muted-foreground">
            生成失败，请关闭后重试。
          </div>
        ) : (
          <div className="flex min-h-0 flex-1">
            {/* Left: param list */}
            <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-muted/20">
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
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </aside>

            {/* Center: image workbench */}
            <section className="flex min-w-0 flex-1 flex-col">
              {/* Search bar */}
              <div className="border-b border-border px-4 py-2.5">
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <input
                      value={searchInput}
                      onChange={(e) => setSearchInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void doSearch();
                      }}
                      placeholder="搜知识库：参数关键词 / 模块名，如 知识图谱 多形态"
                      className="h-9 w-full rounded-md border border-border bg-background pl-8 pr-3 text-sm outline-none focus:border-brand"
                    />
                  </div>
                  <Button size="sm" onClick={() => void doSearch()} disabled={searching}>
                    {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                    搜知识库
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setShowInfo((v) => !v)}
                    title={showInfo ? '收起作业说明面板' : '展开作业说明面板'}
                  >
                    {showInfo ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
                  </Button>
                </div>
              </div>

              <div className="flex min-h-0 flex-1">
                {/* Image column */}
                <div className="min-h-0 flex-1 overflow-y-auto p-4">
                  {/* Selected strip */}
                  <div className="mb-4 rounded-md border border-brand/20 bg-brand/5 p-2.5">
                    <p className="mb-2 flex items-center gap-1 text-xs font-medium text-brand">
                      <Images className="h-3.5 w-3.5" />
                      已选截图（{activeItem.selectedAssetIds.length}）· 拖动调整导出顺序，点击 × 移除
                    </p>
                    {activeItem.references.length === 0 ? (
                      <p className="py-2 text-center text-xs text-muted-foreground">
                        还未选图，从下方知识库搜索结果或推荐参考中挑选
                      </p>
                    ) : (
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
                              'group relative w-28 shrink-0 cursor-grab overflow-hidden rounded border bg-card active:cursor-grabbing',
                              dragAsset === ref.assetId ? 'border-brand opacity-50' : 'border-border hover:border-brand/50',
                            )}
                          >
                            <div className="flex items-center justify-between bg-muted/60 px-1 py-0.5 text-[10px] text-muted-foreground">
                              <GripVertical className="h-3 w-3" />
                              <span className="font-mono">#{idx + 1}</span>
                            </div>
                            <a href={`/api/files/preview/${ref.assetId}`} target="_blank" rel="noreferrer">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={`/api/files/preview/${ref.assetId}`}
                                                alt=""
                                className="h-20 w-full object-cover"
                              />
                            </a>
                            <button
                              type="button"
                              aria-label="移除"
                              onClick={() => toggleAsset(activeItem, ref.assetId)}
                              className="absolute right-0.5 top-6 rounded-full bg-background/85 text-muted-foreground transition hover:text-destructive"
                            >
                              <XCircle className="h-4 w-4" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Search results */}
                  <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                    <Search className="h-4 w-4 text-brand" />
                    知识库搜索
                    {searchedFor && (
                      <span className="text-xs font-normal text-muted-foreground">
                        「{searchKeyword}」· {hits.length} 张
                        {hits.length === 0 && !searching && '（换个关键词试试，或看下方推荐参考）'}
                      </span>
                    )}
                  </div>

                  {searching ? (
                    <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                      <Loader2 className="h-5 w-5 animate-spin text-brand" /> 正在搜索知识库…
                    </div>
                  ) : hits.length > 0 ? (
                    <div className="space-y-4">
                      {hitGroups.map(({ hit: first, items: groupHits }) => {
                        const g = first.group;
                        const allIn = groupHits.every((h) => activeItem.selectedAssetIds.includes(h.assetId));
                        return (
                          <div key={g.groupId} className="rounded-lg border border-border bg-card">
                            <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
                              <div className="min-w-0 text-xs">
                                <p className="flex items-center gap-1.5">
                                  <span className="rounded bg-brand/15 px-1.5 py-px text-[10px] text-brand">
                                    整组 · {g.imageCount} 张
                                  </span>
                                  <span className="line-clamp-1 font-medium">{g.sectionTitle}</span>
                                </p>
                                <p className="mt-0.5 text-muted-foreground">
                                  {g.sourceProjectName ? `来自：${g.sourceProjectName}` : '知识库历史交付'}
                                  {g.sourceSchool ? ` · ${g.sourceSchool}` : ''}
                                </p>
                              </div>
                              <Button
                                size="sm"
                                variant={allIn ? 'outline' : 'default'}
                                className="h-7 shrink-0 px-2.5 text-xs"
                                onClick={() => addHitGroup(activeItem, g.groupId)}
                              >
                                <Layers className="h-3.5 w-3.5" />
                                {allIn ? '已在已选' : '整组加入'}
                              </Button>
                            </div>
                            <div className="grid grid-cols-2 gap-2 p-2.5 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
                              {groupHits.map((h) => {
                                const checked = activeItem.selectedAssetIds.includes(h.assetId);
                                return (
                                  <button
                                    key={h.assetId}
                                    type="button"
                                    onClick={() => addHitAsset(activeItem, h)}
                                    className={cn(
                                      'group relative overflow-hidden rounded-md border text-left transition',
                                      checked ? 'border-brand ring-2 ring-brand/30' : 'border-border hover:border-brand/50',
                                    )}
                                    title={g.sectionTitle}
                                  >
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img
                                      src={`/api/files/preview/${h.assetId}`}
                                      alt=""
                                      loading="lazy"
                                      className="h-28 w-full object-cover"
                                    />
                                    <span
                                      className={cn(
                                        'absolute left-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full border',
                                        checked
                                          ? 'border-brand bg-brand text-white'
                                          : 'border-white/70 bg-black/40 text-transparent group-hover:text-white/80',
                                      )}
                                    >
                                      {checked ? <Check className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
                                    </span>
                                    <span className="flex items-center justify-between bg-background/90 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                                      <span className="truncate">第 {h.seqInGroup + 1} 张</span>
                                      {checked ? (
                                        <span className="inline-flex items-center text-brand">
                                          <Check className="h-3 w-3" /> 已选
                                        </span>
                                      ) : (
                                        <Eye className="h-3 w-3" />
                                      )}
                                    </span>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : searchedFor ? (
                    <div className="rounded-md border border-dashed border-border py-8 text-center text-xs text-muted-foreground">
                      知识库中未搜到与「{searchKeyword}」相关的截图
                    </div>
                  ) : null}

                  {/* Recommended (auto recall) */}
                  <div className="mt-6 border-t border-border pt-4">
                    <p className="mb-2 flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
                      <Sparkles className="h-4 w-4" />
                      系统推荐参考（自动召回）
                    </p>
                    {recommendSources.length === 0 ? (
                      <p className="text-xs text-muted-foreground">暂无自动推荐，可直接用上方搜索。</p>
                    ) : (
                      <div className="space-y-2">
                        {recommendSources.map((s) => {
                          const selectedIds = new Set(activeItem.selectedAssetIds);
                          const allIn = s.refs.length > 0 && s.refs.every((r) => selectedIds.has(r.assetId));
                          return (
                            <div key={s.id} className="rounded-md border border-border bg-muted/20">
                              <div className="flex items-center justify-between gap-2 px-2.5 py-1.5">
                                <div className="min-w-0 text-xs">
                                  <span
                                    className={cn(
                                      'mr-1 rounded px-1 py-px text-[10px]',
                                      s.kind === 'group' ? 'bg-brand/15 text-brand' : 'bg-muted text-muted-foreground',
                                    )}
                                  >
                                    {s.kind === 'group' ? '整组' : '散图'}
                                  </span>
                                  <span className="line-clamp-1 break-all">
                                    {s.title} · {s.imageCount} 张
                                    {s.sourceProjectName ? ` · ${s.sourceProjectName}` : ''}
                                  </span>
                                </div>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-6 shrink-0 px-2 text-xs"
                                  onClick={() => {
                                    const ids = new Set(activeItem.selectedAssetIds);
                                    if (allIn) for (const r of s.refs) ids.delete(r.assetId);
                                    else for (const r of s.refs) ids.add(r.assetId);
                                    const ordered: string[] = [];
                                    for (const src of activeItem.referenceSources ?? []) {
                                      for (const r of src.refs) if (ids.has(r.assetId)) ordered.push(r.assetId);
                                    }
                                    updateItem(activeItem.itemId, {
                                      selectedAssetIds: ordered,
                                      references: resolveReferences(activeItem, ordered),
                                    });
                                  }}
                                >
                                  {allIn ? '取消整组' : '全选整组'}
                                </Button>
                              </div>
                              <div className="grid grid-cols-3 gap-1.5 p-2 sm:grid-cols-4 md:grid-cols-6">
                                {s.refs.map((ref) => {
                                  const checked = activeItem.selectedAssetIds.includes(ref.assetId);
                                  return (
                                    <button
                                      key={ref.assetId}
                                      type="button"
                                      onClick={() => toggleAsset(activeItem, ref.assetId)}
                                      className={cn(
                                        'relative overflow-hidden rounded border',
                                        checked ? 'border-brand ring-1 ring-brand' : 'border-border hover:border-brand/40',
                                      )}
                                      title={ref.visionNote ?? ''}
                                    >
                                      {/* eslint-disable-next-line @next/next/no-img-element */}
                                      <img
                                        src={`/api/files/preview/${ref.assetId}`}
                                        alt=""
                                        loading="lazy"
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
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>

                {/* Right: instruction panel (collapsible) */}
                {showInfo && (
                  <aside className="flex w-80 shrink-0 flex-col border-l border-border">
                    <div className="flex items-center justify-between border-b border-border px-4 py-2 text-sm">
                      <span className="font-medium">作业说明 / 状态</span>
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
                    <div className="min-h-0 flex-1 overflow-y-auto p-4">
                      <div className="mb-3 rounded bg-muted/40 p-2 text-xs text-muted-foreground">
                        <p className="mb-1 font-medium text-foreground">{activeItem.title}</p>
                        <p className="max-h-28 overflow-y-auto">{activeItem.requirement}</p>
                        {activeItem.score != null && <p className="mt-1">分值：{activeItem.score}</p>}
                      </div>
                      {editing ? (
                        <>
                          <Textarea
                            value={draft}
                            onChange={(e) => setDraft(e.target.value)}
                            className="min-h-[260px] resize-none text-sm leading-relaxed"
                            placeholder="写明到哪个菜单、截什么、如何证明满足要求…"
                          />
                          <div className="mt-2 flex justify-end gap-2">
                            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                              取消
                            </Button>
                            <Button size="sm" variant="default" onClick={saveDraft}>
                              <CheckCircle2 className="h-4 w-4" /> 保存
                            </Button>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="whitespace-pre-wrap rounded-md border border-border p-3 text-sm leading-relaxed">
                            {activeItem.instruction || (
                              <span className="text-muted-foreground">暂无说明，点击「编辑」补充。</span>
                            )}
                          </div>
                          <Button size="sm" variant="outline" className="mt-2 w-full" onClick={() => { setDraft(activeItem.instruction); setEditing(true); }}>
                            <Pencil className="h-4 w-4" /> 编辑说明
                          </Button>
                        </>
                      )}
                      <div className="mt-4 rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
                        <div className="flex items-center gap-1.5 font-medium text-foreground">
                          <FileDown className="h-3.5 w-3.5" />
                          建议文件名
                        </div>
                        <p className="mt-1 font-mono break-all">{activeItem.suggestedFileName}</p>
                      </div>
                    </div>
                  </aside>
                )}
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
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
      <Loader2 className="h-12 w-12 animate-spin text-brand" />
      <div className="w-full max-w-md space-y-2 text-center">
        <p className="text-sm font-medium">{STEP_LABEL[progress.step] ?? '生成中'}…</p>
        <p className="text-xs text-muted-foreground">{progress.detail}</p>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-brand transition-all duration-300" style={{ width: `${pct}%` }} />
        </div>
      </div>
    </div>
  );
}
