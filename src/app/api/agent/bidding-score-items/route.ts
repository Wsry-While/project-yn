import { NextRequest } from 'next/server';
import { LLMClient, Config, HeaderUtils } from 'coze-coding-dev-sdk';
import { fail, withApi } from '@/lib/domain/http';
import { requireUser } from '@/lib/domain/api-utils';
import { getSupabaseAdminClient } from '@/lib/supabase-client';
import { BiddingScreenshotService } from '@/lib/domain/bidding-screenshot-service';
import { buildMessages, getModelForScenario } from '@/lib/domain/llm-prompts';
import { parseAssetDocument, extractScoringSection } from '@/lib/domain/parse/document-parser';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// 文档解析 + LLM 可能较慢
export const maxDuration = 120;

/**
 * POST /api/agent/bidding-score-items
 * body: { screenshotId: string }
 *
 * 读取该招投标记录的「项目招标文件」，抽取评分办法并以 SSE 流式返回严格 JSON。
 * 事件：meta（项目/文件名）→ delta（JSON 文本增量）→ done/error。
 */
export async function POST(request: NextRequest) {
  return withApi(async () => {
    const auth = await requireUser(request);
    if ('status' in auth) return auth;

    const body = (await request.json().catch(() => ({}))) as { screenshotId?: unknown };
    if (typeof body.screenshotId !== 'string' || !body.screenshotId) {
      return fail('invalid_param', 'screenshotId 不能为空', 400);
    }

    const db = getSupabaseAdminClient();
    const service = new BiddingScreenshotService(db);
    const record = await service.getById(body.screenshotId);
    if (!record) return fail('not_found', '招投标记录不存在', 404);

    const biddingFile = Array.isArray(record.projectBiddingFile)
      ? record.projectBiddingFile[0]
      : record.projectBiddingFile;
    if (!biddingFile?.assetId) {
      return fail('file_not_ready', '该记录的招标文件尚未转存完成，请先在详情中重新获取附件', 409);
    }

    const encoder = new TextEncoder();
    const customHeaders = HeaderUtils.extractForwardHeaders(request.headers);

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (obj: Record<string, unknown>) =>
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
        try {
          send({
            type: 'meta',
            projectName: record.projectName,
            school: record.projectSchool,
            fileName: biddingFile.name || '招标文件',
          });

          const parsed = await parseAssetDocument(biddingFile.assetId);
          if (parsed.kind === 'unsupported') {
            send({
              type: 'error',
              message: `暂不支持解析该文件类型（${parsed.fileName}），请上传 PDF 或 Word（.docx）。`,
            });
            return;
          }
          const section = extractScoringSection(parsed.text);

          const prompt = [
            `项目名称：${record.projectName}`,
            `学校：${record.projectSchool}`,
            section.matched ? '以下是从招标文件中定位到的评分办法章节原文：' : '未能精确定位评分办法章节，以下是文档文本（可能较长，请从中抽取评分项）：',
            '-----原文开始-----',
            section.text,
            '-----原文结束-----',
          ].join('\n');

          const messages = buildMessages({
            scenario: 'bidding-score',
            prompt,
          });
          const client = new LLMClient(new Config({ timeout: 120_000 }), customHeaders);
          for await (const part of client.stream(messages, {
            model: getModelForScenario('bidding-score'),
            temperature: 0.2,
          })) {
            const text = part?.content?.toString?.() ?? '';
            if (text) send({ type: 'delta', content: text });
          }
          send({ type: 'done', truncated: parsed.truncated });
        } catch (err) {
          console.error('[agent/bidding-score-items] error:', err);
          send({ type: 'error', message: err instanceof Error ? err.message : '评分项抽取失败' });
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
