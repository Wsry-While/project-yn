'use client';

import { useEffect, useMemo, useState } from 'react';
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
} from 'lucide-react';
import { apiFetchSSE } from '@/lib/web/api-client';
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
  /** 整组匹配时的参数小节标题（这组图共同响应同一条参数） */
  referenceGroupTitle?: string | null;
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

export function ScreenshotGuideDialog({ open, recordId, onClose, onExport, exporting }: Props) {
  const [loading, setLoading] = useState(false);
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

  const activeItem = useMemo(
    () => guide?.items.find((i) => i.itemId === activeId) ?? null,
    [guide, activeId],
  );

  useEffect(() => {
    if (!open || !recordId) return;
    let cancelled = false;
    setLoading(true);
    setGuide(null);
    setProgress({ step: 'load', detail: '开始生成…', percent: 0 });

    const cancel = apiFetchSSE(
      `/api/bidding-screenshots/${recordId}/screenshot-guide`,
      {},
      {
        onDelta: () => {},
        onStep: (s) => {
          if (cancelled) return;
          setProgress({
            step: String(s.step ?? ''),
            detail: String(s.detail ?? s.message ?? ''),
            percent: typeof s.percent === 'number' ? s.percent : 0,
          });
        },
        onDone: (evt) => {
          if (cancelled) return;
          const g = (evt as { guide?: ScreenshotGuide } | undefined)?.guide;
          if (g) {
            setGuide(g);
            setActiveId(g.items[0]?.itemId ?? null);
          }
          setLoading(false);
        },
        onError: (err) => {
          if (cancelled) return;
          setLoading(false);
          showToast(err.message || '生成截图指导书失败', { kind: 'error' });
        },
      },
    );
    return () => {
      cancelled = true;
      cancel();
    };
  }, [open, recordId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

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
    updateItem(activeItem.itemId, { instruction: draft });
    setEditing(false);
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
                variant="default"
                disabled={exporting}
                onClick={() => onExport(guide)}
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
              onClick={onClose}
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
                          {item.references.length > 0 && (
                            <span className="text-status-success">· {item.references.length} 参考</span>
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
                  {/* Reference image */}
                  <div className="flex min-h-0 flex-col border-b border-border lg:border-b-0 lg:border-r">
                    <div className="flex items-center justify-between border-b border-border px-4 py-2 text-sm">
                      <span className="font-medium">历史参考截图</span>
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
                      {activeItem.references.length === 0 ? (
                        <div className="flex h-full min-h-[200px] flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
                          <ImageIcon className="h-8 w-8 opacity-40" />
                          知识库暂无此项的历史参考图
                          <span className="text-xs">请按通用规范截图或标记「待补充」</span>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {activeItem.referenceGroupTitle && activeItem.references.length > 1 && (
                            <div className="flex items-start gap-2 rounded-md border border-brand/20 bg-brand/5 p-2.5 text-xs">
                              <Layers className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
                              <div className="min-w-0">
                                <p className="font-medium text-brand">
                                  整组截图 · 该参数由 {activeItem.references.length} 张截图共同响应
                                </p>
                                <p className="mt-0.5 break-all text-muted-foreground">
                                  {activeItem.referenceGroupTitle}
                                </p>
                                <p className="mt-0.5 text-muted-foreground">
                                  请按顺序截取形态/界面的全部截图，完整证明该参数。
                                </p>
                              </div>
                            </div>
                          )}
                          <ReferenceViewer reference={activeItem.references[refIndex]} />
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
