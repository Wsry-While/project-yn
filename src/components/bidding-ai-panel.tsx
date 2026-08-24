'use client';

import { useRef, useState } from 'react';
import { Brain, ClipboardCopy, Download, FileSearch, GraduationCap, Loader2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { apiFetch, apiFetchSSE, ApiError } from '@/lib/web/api-client';
import { showToast } from '@/lib/web/toast-store';
import { datedName } from '@/lib/web/csv-export';
import type { BiddingScreenshot } from '@/lib/domain/types';

interface ScoreItem {
  name?: string;
  category?: string;
  criteria?: string;
  maxScore?: number | null;
  suggestedEvidence?: string;
}
interface ScoreResult {
  scoringMethod?: string;
  fullTextDigest?: string;
  scoreItems?: ScoreItem[];
}

interface LearnedItem {
  assetId: string;
  name: string;
  result: { systemModule: string | null; pagePath: string | null; description: string; observedElements: string[]; usableFor: string[] } | null;
  error?: string;
}

export function BiddingAiPanel({ record }: { record: BiddingScreenshot }) {
  const [scoreText, setScoreText] = useState('');
  const [scoreParsed, setScoreParsed] = useState<ScoreResult | null>(null);
  const [scoring, setScoring] = useState(false);

  const [advice, setAdvice] = useState('');
  const [advising, setAdvising] = useState(false);
  const [meta, setMeta] = useState<{ exampleCount?: number; staleCount?: number } | null>(null);

  const [learning, setLearning] = useState(false);
  const [learned, setLearned] = useState<LearnedItem[] | null>(null);

  const hasBiddingFile = !!record.projectBiddingFile && (Array.isArray(record.projectBiddingFile)
    ? record.projectBiddingFile[0]?.assetId
    : record.projectBiddingFile.assetId);

  // 用 ref 持有增量拼接文本，onDone 时解析；state 仅用于渲染。
  const scoreAccum = useRef('');

  const extractScore = () => {
    if (scoring) return;
    setScoring(true);
    setScoreText('');
    setScoreParsed(null);
    setAdvice('');
    setMeta(null);
    scoreAccum.current = '';
    apiFetchSSE(
      '/api/agent/bidding-score-items',
      { screenshotId: record.id },
      {
        onDelta: (t) => {
          scoreAccum.current += t;
          setScoreText(scoreAccum.current);
        },
        onMeta: () => {},
        onDone: () => {
          setScoring(false);
          setScoreParsed(safeParse(scoreAccum.current));
        },
        onError: (err) => {
          setScoring(false);
          showToast(err.message || '评分项抽取失败', { kind: 'error' });
        },
      },
    );
  };

  const generateAdvice = () => {
    if (!scoreParsed?.scoreItems?.length) {
      showToast('请先抽取评分项', { kind: 'error' });
      return;
    }
    if (advising) return;
    setAdvising(true);
    setAdvice('');
    setMeta(null);
    apiFetchSSE(
      '/api/agent/bidding-screenshot-advice',
      {
        screenshotId: record.id,
        scoreItems: scoreParsed.scoreItems,
        scoringMethod: scoreParsed.scoringMethod,
        fullTextDigest: scoreParsed.fullTextDigest,
      },
      {
        onMeta: (m) => setMeta(m as typeof meta),
        onDelta: (t) => setAdvice((prev) => prev + t),
        onDone: () => setAdvising(false),
        onError: (err) => {
          setAdvising(false);
          showToast(err.message || '生成建议失败', { kind: 'error' });
        },
      },
    );
  };

  const learn = async () => {
    if (learning) return;
    setLearning(true);
    setLearned(null);
    try {
      const data = await apiFetch<{ total: number; learned: LearnedItem[] }>('/api/agent/bidding-learn', {
        method: 'POST',
        body: JSON.stringify({ screenshotId: record.id }),
      });
      setLearned(data.learned);
      const okCount = data.learned.filter((l) => l.result).length;
      showToast(`已学习 ${okCount}/${data.total} 张交付截图`, { kind: okCount ? 'success' : 'info' });
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : '学习失败', { kind: 'error' });
    } finally {
      setLearning(false);
    }
  };

  const copyAdvice = () => {
    if (!advice) return;
    void navigator.clipboard.writeText(advice);
    showToast('已复制到剪贴板', { kind: 'success' });
  };
  const downloadAdvice = () => {
    if (!advice) return;
    const blob = new Blob([advice], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${datedName(`截图建议-${record.projectName}`)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4 rounded-lg border border-border bg-muted/20 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5 text-sm font-semibold">
          <Brain className="h-4 w-4 text-brand" />
          AI 招投标截图助手
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={extractScore} disabled={scoring || !hasBiddingFile}>
            {scoring ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <FileSearch className="mr-1 h-3.5 w-3.5" />}
            1. 读取招标文件抽取评分项
          </Button>
          <Button size="sm" variant="outline" onClick={generateAdvice} disabled={advising || !scoreParsed?.scoreItems?.length}>
            {advising ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1 h-3.5 w-3.5" />}
            2. 生成截图建议
          </Button>
          <Button size="sm" variant="outline" onClick={learn} disabled={learning}>
            {learning ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <GraduationCap className="mr-1 h-3.5 w-3.5" />}
            3. 交付文档入知识库学习
          </Button>
        </div>
      </div>

      {!hasBiddingFile ? (
        <p className="text-xs text-muted-foreground">该记录的招标文件尚未转存到本系统，请先在上方「项目招标文件」处点击「获取」附件。</p>
      ) : null}

      {scoreText ? (
        <div className="space-y-2">
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">评分项（结构化 JSON）</div>
          {scoreParsed?.scoreItems?.length ? (
            <ul className="space-y-1.5">
              {scoreParsed.scoreItems.map((s, i) => (
                <li key={i} className="rounded border border-border bg-card p-2 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{s.name || `评分项 ${i + 1}`}</span>
                    <span className="shrink-0 rounded bg-brand/10 px-1.5 py-0.5 text-[10px] text-brand">
                      {s.category || '其他'} · {s.maxScore ?? '—'} 分
                    </span>
                  </div>
                  {s.criteria ? <p className="mt-1 text-muted-foreground">{s.criteria}</p> : null}
                  {s.suggestedEvidence ? (
                    <p className="mt-1 text-foreground/80">📌 {s.suggestedEvidence}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <pre className="max-h-60 overflow-auto whitespace-pre-wrap rounded border border-border bg-card p-2 text-[11px] leading-relaxed">
              {scoreText}
            </pre>
          )}
        </div>
      ) : null}

      {advice || advising ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              截图作业指导
              {meta ? ` · 参考 ${meta.exampleCount ?? 0} 条历史示例${meta.staleCount ? `（${meta.staleCount} 条过期）` : ''}` : ''}
            </div>
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" className="h-7 px-2" onClick={copyAdvice} disabled={!advice}>
                <ClipboardCopy className="h-3.5 w-3.5" />
              </Button>
              <Button size="sm" variant="ghost" className="h-7 px-2" onClick={downloadAdvice} disabled={!advice}>
                <Download className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
          <div className="prose-sm max-h-[28rem] overflow-auto whitespace-pre-wrap rounded border border-border bg-card p-3 text-xs leading-relaxed">
            {advice}
            {advising ? <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-brand align-middle" /> : null}
          </div>
        </div>
      ) : null}

      {learned ? (
        <div className="space-y-1.5">
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">学习结果</div>
          <ul className="space-y-1">
            {learned.map((l, i) => (
              <li key={i} className="rounded border border-border bg-card p-2 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium">{l.name}</span>
                  <span className={l.result ? 'text-emerald-600' : 'text-red-500'}>{l.result ? '已入库' : l.error || '失败'}</span>
                </div>
                {l.result?.description ? <p className="mt-1 text-muted-foreground">{l.result.description}</p> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function safeParse(text: string): ScoreResult | null {
  if (!text) return null;
  const cleaned = text.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  try {
    const obj = JSON.parse(cleaned) as ScoreResult;
    if (obj && Array.isArray(obj.scoreItems)) return obj;
  } catch {
    const s = cleaned.indexOf('{');
    const e = cleaned.lastIndexOf('}');
    if (s >= 0 && e > s) {
      try {
        return JSON.parse(cleaned.slice(s, e + 1)) as ScoreResult;
      } catch {
        return null;
      }
    }
  }
  return null;
}
