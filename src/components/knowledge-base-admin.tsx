'use client';

import { useCallback, useEffect, useState } from 'react';
import { BrainCog, Loader2, Play, RefreshCw, CheckCircle2 } from 'lucide-react';
import { apiFetch, apiFetchSSE } from '@/lib/web/api-client';
import { showToast } from '@/lib/web/toast-store';
import { Button } from '@/components/ui/button';

interface KbVersion {
  version: string;
  totalImages: number;
  totalMappings: number;
  finishedAt: string | null;
}

interface LearnProgress {
  step: string;
  detail: string;
  percent: number;
}

/**
 * 截图知识库 1.0 管理面板（仅超级管理员可见）。
 * - 展示最新学习版本与覆盖量；
 * - 一键全库扫描历史交付图，逐图做参数级视觉理解，沉淀参数↔图片映射；
 * - SSE 展示进度。
 */
export function KnowledgeBaseAdmin() {
  const [latest, setLatest] = useState<KbVersion | null>(null);
  const [loading, setLoading] = useState(false);
  const [learning, setLearning] = useState(false);
  const [progress, setProgress] = useState<LearnProgress>({ step: '', detail: '', percent: 0 });

  const loadLatest = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<KbVersion | null>('/api/admin/kb/learn');
      setLatest(data);
    } catch (err) {
      // 静默：未学习过时接口返回 null
      console.warn('加载知识库版本失败', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadLatest();
  }, [loadLatest]);

  const startLearn = () => {
    setLearning(true);
    setProgress({ step: 'init', detail: '初始化学习任务…', percent: 0 });
    const cancel = apiFetchSSE(
      '/api/admin/kb/learn',
      {},
      {
        onDelta: () => {},
        onStep: (s) => {
          setProgress({
            step: String(s.step ?? ''),
            detail: String(s.detail ?? s.message ?? ''),
            percent: typeof s.percent === 'number' ? s.percent : 0,
          });
        },
        onDone: (evt) => {
          setLearning(false);
          const data = evt as { version?: string; totalImages?: number; totalMappings?: number } | undefined;
          showToast(
            `知识库学习完成${data?.version ? `（${data.version}）` : ''}，共沉淀 ${data?.totalMappings ?? 0} 条参数映射`,
            { kind: 'success' },
          );
          loadLatest();
        },
        onError: (err) => {
          setLearning(false);
          showToast(err.message || '知识库学习失败', { kind: 'error' });
        },
      },
    );
    return cancel;
  };

  const pct = Math.min(100, Math.max(0, progress.percent));

  return (
    <section className="rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
        <div className="flex items-center gap-2">
          <BrainCog className="h-4 w-4 text-brand" />
          <h2 className="text-sm font-semibold">截图知识库 1.0</h2>
        </div>
        <Button
          size="xs"
          variant="outline"
          className="h-7"
          onClick={loadLatest}
          disabled={loading || learning}
          title="刷新最新版本"
        >
          <RefreshCw className={loading ? 'h-3 w-3 animate-spin' : 'h-3 w-3'} />
        </Button>
      </div>

      <div className="space-y-4 p-5">
        <p className="text-sm text-muted-foreground">
          对全库所有历史交付截图进行参数级视觉理解，识别「参数 ↔ 图片」对应关系，
          为「截图作业指导书」生成提供参考。学习过程只读原图、写入知识库，不修改业务数据。
        </p>

        {latest ? (
          <div className="grid grid-cols-3 gap-3 rounded-md border border-border bg-muted/30 p-4">
            <Stat label="当前版本" value={latest.version} mono />
            <Stat label="已学习图片" value={String(latest.totalImages)} />
            <Stat label="参数映射" value={String(latest.totalMappings)} />
            <div className="col-span-3 text-xs text-muted-foreground">
              最近完成：{latest.finishedAt ? new Date(latest.finishedAt).toLocaleString('zh-CN') : '—'}
            </div>
          </div>
        ) : (
          <div className="rounded-md border border-dashed border-border bg-muted/20 p-4 text-sm text-muted-foreground">
            尚未生成知识库版本。点击下方按钮，对全库历史交付图进行一次性扫描学习。
          </div>
        )}

        {learning ? (
          <div className="space-y-2 rounded-md border border-brand/30 bg-brand/[0.04] p-4">
            <div className="flex items-center gap-2 text-sm font-medium text-brand">
              <Loader2 className="h-4 w-4 animate-spin" />
              正在学习…{progress.detail}
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-brand transition-all duration-300"
                style={{ width: `${pct}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              全库扫描可能耗时较长，请保持页面打开；完成后会自动刷新版本信息。
            </p>
          </div>
        ) : (
          <Button onClick={startLearn} disabled={learning}>
            {latest ? <RefreshCw className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            {latest ? '重新全库学习' : '开始全库学习'}
          </Button>
        )}

        {!learning && latest && (
          <p className="flex items-center gap-1.5 text-xs text-status-success">
            <CheckCircle2 className="h-3.5 w-3.5" />
            知识库已就绪，可在招投标交付文档中生成「截图指导书」。
          </p>
        )}
      </div>
    </section>
  );
}

function Stat({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`mt-0.5 text-lg font-semibold ${mono ? 'font-mono' : ''}`}>{value}</div>
    </div>
  );
}
