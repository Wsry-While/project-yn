'use client';

import { useCallback, useRef, useState } from 'react';
import {
  Calendar,
  ClipboardCopy,
  Download,
  FileText,
  Sparkles,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { apiFetch, apiFetchSSE } from '@/lib/web/api-client';
import { showToast } from '@/lib/web/toast-store';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { KpiCard } from '@/components/kpi-card';
import type { WeeklyReportData } from '@/lib/domain/weekly-report-service';

function shiftDate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function MarkdownLite({ text }: { text: string }) {
  // 极简 Markdown 渲染：仅处理 ## 标题、- 列表、**粗体**、空行
  const blocks = text.split(/\n{2,}/);
  return (
    <div className="space-y-3 text-[13px] leading-7 text-foreground/90">
      {blocks.map((blk, idx) => {
        if (blk.startsWith('## ')) {
          return (
            <h2 key={idx} className="pt-2 text-base font-semibold text-foreground">
              {blk.slice(3)}
            </h2>
          );
        }
        if (blk.startsWith('- ')) {
          const items = blk.split('\n').filter((l) => l.trim().startsWith('- '));
          return (
            <ul key={idx} className="space-y-1 pl-1">
              {items.map((it, i) => (
                <li key={i} className="flex gap-2">
                  <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-brand" />
                  <span dangerouslySetInnerHTML={{ __html: renderInline(it.slice(2)) }} />
                </li>
              ))}
            </ul>
          );
        }
        return <p key={idx} dangerouslySetInnerHTML={{ __html: renderInline(blk) }} />;
      })}
    </div>
  );
}

function renderInline(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\*\*([^*]+)\*\*/g, '<strong class="text-foreground font-semibold">$1</strong>')
    .replace(/`([^`]+)`/g, '<code class="rounded bg-muted px-1 py-0.5 font-mono text-[12px]">$1</code>');
}

export function WeeklyReportView() {
  const today = shiftDate(0);
  const weekAgo = shiftDate(-6);
  const [startDate, setStartDate] = useState(weekAgo);
  const [endDate, setEndDate] = useState(today);
  const [extraPrompt, setExtraPrompt] = useState('');
  const [data, setData] = useState<WeeklyReportData | null>(null);
  const [loadingData, setLoadingData] = useState(false);
  const [report, setReport] = useState('');
  const [generating, setGenerating] = useState(false);
  const abortRef = useRef<(() => void) | null>(null);
  const reportRef = useRef<HTMLDivElement>(null);

  const loadData = useCallback(async () => {
    setLoadingData(true);
    try {
      const qs = new URLSearchParams({ startDate, endDate });
      const result = await apiFetch<WeeklyReportData>(`/api/reports/weekly/data?${qs.toString()}`);
      setData(result);
    } catch (err) {
      showToast(err instanceof Error ? err.message : '加载周报数据失败', { kind: 'error' });
    } finally {
      setLoadingData(false);
    }
  }, [startDate, endDate]);

  const generate = useCallback(() => {
    setReport('');
    setGenerating(true);
    abortRef.current = apiFetchSSE(
      '/api/reports/weekly/generate',
      { startDate, endDate, extraPrompt },
      {
        onDelta: (t) => {
          setReport((r) => r + t);
          requestAnimationFrame(() => {
            reportRef.current?.scrollTo({ top: reportRef.current.scrollHeight, behavior: 'smooth' });
          });
        },
        onDone: () => setGenerating(false),
        onError: (err) => {
          setGenerating(false);
          showToast(err.message, { kind: 'error' });
        },
      },
    );
  }, [startDate, endDate, extraPrompt]);

  const stop = useCallback(() => {
    abortRef.current?.();
    setGenerating(false);
  }, []);

  const copyReport = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(report);
      showToast('周报已复制到剪贴板', { kind: 'success' });
    } catch {
      showToast('复制失败，请手动选择文本', { kind: 'error' });
    }
  }, [report]);

  const downloadMarkdown = useCallback(() => {
    const blob = new Blob([report], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `weekly-report-${startDate}-to-${endDate}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }, [report, startDate, endDate]);

  return (
    <div className="space-y-5">
      <PageHeader
        icon={<FileText className="h-4 w-4" />}
        title="AI 周报"
        subtitle="基于项目外出、招投标、建设申请、启明星四源数据自动生成周报，支持流式输出、复制与 Markdown 导出"
        breadcrumb={[{ label: '分析' }, { label: 'AI 周报' }]}
      />

      <div className="rounded-md border border-border bg-card p-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <label className="space-y-1">
            <span className="text-[11px] text-muted-foreground">开始日期</span>
            <Input
              type="date"
              value={startDate}
              max={endDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="h-8"
            />
          </label>
          <label className="space-y-1">
            <span className="text-[11px] text-muted-foreground">结束日期</span>
            <Input
              type="date"
              value={endDate}
              min={startDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="h-8"
            />
          </label>
          <label className="space-y-1 md:col-span-2">
            <span className="text-[11px] text-muted-foreground">附加要求（可选）</span>
            <Input
              value={extraPrompt}
              onChange={(e) => setExtraPrompt(e.target.value)}
              placeholder="如：重点关注 XX 大学，突出交付情况"
              className="h-8"
            />
          </label>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={loadData} disabled={loadingData}>
            <Calendar className="h-3.5 w-3.5" />
            {loadingData ? '加载中…' : '加载数据'}
          </Button>
          <div className="flex gap-1">
            {[
              { label: '近 7 天', days: 7 },
              { label: '近 14 天', days: 14 },
              { label: '近 30 天', days: 30 },
            ].map((p) => (
              <button
                key={p.days}
                type="button"
                onClick={() => {
                  setEndDate(shiftDate(0));
                  setStartDate(shiftDate(-(p.days - 1)));
                }}
                className="rounded-sm border border-border bg-background px-2 py-1 text-[11px] text-muted-foreground transition hover:bg-muted/40"
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="ml-auto flex gap-2">
            {generating ? (
              <Button size="sm" variant="outline" onClick={stop}>
                停止生成
              </Button>
            ) : (
              <Button size="sm" onClick={generate} disabled={!data}>
                <Sparkles className="h-3.5 w-3.5" />
                生成周报
              </Button>
            )}
          </div>
        </div>
      </div>

      {data && (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <KpiCard label="项目外出" value={data.summary.totalTrips} hint={`完成 ${data.summary.completedTrips}`} tone="brand" />
            <KpiCard
              label="客户均分"
              value={data.summary.avgScore == null ? '—' : data.summary.avgScore.toFixed(2)}
              tone="success"
            />
            <KpiCard
              label="新增业务"
              value={data.summary.newBidding + data.summary.newDemands + data.summary.newQiming}
              hint={`招投标 ${data.summary.newBidding} / 建设 ${data.summary.newDemands} / 启明星 ${data.summary.newQiming}`}
              tone="info"
            />
            <KpiCard
              label="逾期"
              value={data.summary.overdueBidding + data.summary.overdueDemands}
              tone={data.summary.overdueBidding + data.summary.overdueDemands > 0 ? 'danger' : 'success'}
              hint="招投标 + 建设申请"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
            <section className="rounded-md border border-border bg-card lg:col-span-2">
              <header className="flex items-center justify-between border-b border-border px-4 py-3">
                <h3 className="text-sm font-semibold">风险速览</h3>
                <span className="text-[11px] text-muted-foreground">{data.risks.length} 条</span>
              </header>
              {data.risks.length === 0 ? (
                <div className="px-4 py-10 text-center text-xs text-muted-foreground">本周暂无风险记录</div>
              ) : (
                <ul className="max-h-80 divide-y divide-border overflow-auto">
                  {data.risks.map((r, i) => (
                    <li key={i} className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <span
                          className={cn(
                            'inline-flex h-1.5 w-1.5 rounded-full',
                            r.level === 'high' ? 'bg-status-danger' : r.level === 'medium' ? 'bg-status-warning' : 'bg-brand',
                          )}
                        />
                        <span className="text-[13px] font-medium">{r.title}</span>
                      </div>
                      <p className="mt-0.5 pl-3.5 text-[11.5px] text-muted-foreground">{r.detail}</p>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="rounded-md border border-border bg-card lg:col-span-3">
              <header className="flex items-center justify-between border-b border-border px-4 py-3">
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                  <Sparkles className="h-3.5 w-3.5 text-brand" />
                  AI 周报正文
                </h3>
                {report && (
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" onClick={copyReport}>
                      <ClipboardCopy className="h-3 w-3" />
                      复制
                    </Button>
                    <Button size="sm" variant="ghost" onClick={downloadMarkdown}>
                      <Download className="h-3 w-3" />
                      MD
                    </Button>
                  </div>
                )}
              </header>
              <div
                ref={reportRef}
                className="max-h-[500px] min-h-[280px] overflow-auto px-5 py-4"
              >
                {report ? (
                  <MarkdownLite text={report} />
                ) : generating ? (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="inline-flex h-2 w-2 animate-pulse rounded-full bg-brand" />
                    AI 正在生成周报，请稍候…
                  </div>
                ) : (
                  <div className="flex h-full flex-col items-center justify-center gap-2 py-12 text-center text-xs text-muted-foreground">
                    <Sparkles className="h-6 w-6 text-brand/50" />
                    <p>点击右上角「生成周报」，AI 将基于左侧数据生成结构化周报</p>
                  </div>
                )}
              </div>
            </section>
          </div>
        </>
      )}
    </div>
  );
}
