import { NextRequest } from 'next/server';
import { LLMClient, Config, HeaderUtils } from 'coze-coding-dev-sdk';
import { fail, withApi } from '@/lib/domain/http';
import { requireUser } from '@/lib/domain/api-utils';
import { getSupabaseAdminClient } from '@/lib/supabase-client';
import { BiddingScreenshotService } from '@/lib/domain/bidding-screenshot-service';
import { ScreenshotExampleService } from '@/lib/domain/screenshot-example-service';
import { buildMessages, getModelForScenario } from '@/lib/domain/llm-prompts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 180;

interface ScoreItem {
  name?: string;
  category?: string;
  criteria?: string;
  maxScore?: number | null;
  suggestedEvidence?: string;
}

interface AdviceBody {
  screenshotId?: unknown;
  scoreItems?: unknown;
  scoringMethod?: unknown;
  fullTextDigest?: unknown;
}

/**
 * POST /api/agent/bidding-screenshot-advice
 * body: { screenshotId, scoreItems, scoringMethod, fullTextDigest }
 *
 * 把评分项与历史示例拼进 prompt，SSE 流式输出截图作业指导 Markdown。
 * 事件：meta → delta → done/error。
 */
export async function POST(request: NextRequest) {
  return withApi(async () => {
    const auth = await requireUser(request);
    if ('status' in auth) return auth;

    const body = (await request.json().catch(() => ({}))) as AdviceBody;
    if (typeof body.screenshotId !== 'string' || !body.screenshotId) {
      return fail('invalid_param', 'screenshotId 不能为空', 400);
    }
    const scoreItems = Array.isArray(body.scoreItems) ? (body.scoreItems as ScoreItem[]) : [];
    if (!scoreItems.length) return fail('invalid_param', 'scoreItems 不能为空', 400);

    const db = getSupabaseAdminClient();
    const [record] = await Promise.all([
      new BiddingScreenshotService(db).getById(body.screenshotId),
    ]);
    if (!record) return fail('not_found', '招投标记录不存在', 404);

    // 用评分项名称 + 建议证据关键词召回历史示例。
    const keywords = scoreItems
      .flatMap((s) => [s.name, s.category, s.suggestedEvidence])
      .filter((v): v is string => typeof v === 'string' && v.length > 0);
    const examples = await new ScreenshotExampleService(db).search(keywords, 6);

    const exampleBlock = examples.length
      ? examples
          .map((e, i) => {
            const lines = [
              `示例${i + 1}：${e.projectName ?? '未知项目'}（${e.school ?? '未知学校'}，${e.salesManager ?? ''}）`,
              `- 系统模块：${e.systemModule ?? '未标注'}`,
              `- 页面路径：${e.pagePath ?? '未标注'}`,
              `- 内容：${e.description ?? ''}`,
              `- 关键要素：${(e.observedElements ?? []).join('、')}`,
              `- 适用评分项：${(e.tags ?? []).join('、')}`,
              `- 参考链接：/bidding-screenshots?focus=${e.screenshotId ?? ''}`,
              e.stale ? `- ⚠️ 该示例已超过 1 个月，系统界面可能已变更，请人工重新截图核对。` : '',
            ];
            return lines.filter(Boolean).join('\n');
          })
          .join('\n\n')
      : '（暂无历史截图示例可参考）';

    const itemsText = scoreItems
      .map((s, i) => `${i + 1}. ${s.name ?? '未命名'}（${s.category ?? '其他'}，分值：${s.maxScore ?? '—'}）\n   标准：${s.criteria ?? ''}\n   需提供：${s.suggestedEvidence ?? ''}`)
      .join('\n');

    const prompt = [
      `项目名称：${record.projectName}`,
      `学校：${record.projectSchool}`,
      `销售经理：${record.salesManager}`,
      `项目经理：${record.assignedProjectManager ?? '—'}`,
      `评分办法：${typeof body.scoringMethod === 'string' ? body.scoringMethod : '综合评分法'}`,
      typeof body.fullTextDigest === 'string' && body.fullTextDigest ? `评分办法概述：${body.fullTextDigest}` : '',
      '',
      '【需要截图的评分项】',
      itemsText,
      '',
      '【可参考的历史交付截图示例】',
      exampleBlock,
      '',
      '请输出这份截图作业指导。',
    ]
      .filter(Boolean)
      .join('\n');

    const customHeaders = HeaderUtils.extractForwardHeaders(request.headers);
    const client = new LLMClient(new Config({ timeout: 180_000 }), customHeaders);
    const messages = buildMessages({ scenario: 'bidding-advice', prompt });

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (obj: Record<string, unknown>) =>
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
        try {
          send({
            type: 'meta',
            projectName: record.projectName,
            exampleCount: examples.length,
            staleCount: examples.filter((e) => e.stale).length,
          });
          for await (const part of client.stream(messages, {
            model: getModelForScenario('bidding-advice'),
            temperature: 0.3,
          })) {
            const text = part?.content?.toString?.() ?? '';
            if (text) send({ type: 'delta', content: text });
          }
          send({ type: 'done' });
        } catch (err) {
          console.error('[agent/bidding-screenshot-advice] error:', err);
          send({ type: 'error', message: err instanceof Error ? err.message : '生成建议失败' });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  });
}
