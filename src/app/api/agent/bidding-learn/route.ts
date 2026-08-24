import { NextRequest } from 'next/server';
import { LLMClient, Config, HeaderUtils } from 'coze-coding-dev-sdk';
import { fail, withApi, ok } from '@/lib/domain/http';
import { requireUser } from '@/lib/domain/api-utils';
import { getSupabaseAdminClient } from '@/lib/supabase-client';
import { BiddingScreenshotService } from '@/lib/domain/bidding-screenshot-service';
import { ScreenshotExampleService } from '@/lib/domain/screenshot-example-service';
import { resolveAssetDownload } from '@/lib/domain/asset-access';
import { getModelForScenario, buildMessages } from '@/lib/domain/llm-prompts';

interface ContentPart {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: { url: string; detail?: 'high' | 'low' };
}
interface VisionMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | ContentPart[];
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 180;

interface VisionResult {
  screenshots: Array<{
    index: number;
    systemModule: string | null;
    pagePath: string | null;
    description: string;
    observedElements: string[];
    usableFor: string[];
  }>;
}

/**
 * POST /api/agent/bidding-learn
 * body: { screenshotId: string }
 *
 * 对一条招投标记录的「交付文档/附件」截图做多模态理解，把每张图的内容
 * （系统模块、页面路径、关键要素、可用于哪类评分项）沉淀到示例库，形成闭环。
 * 同步返回解析结果 JSON（非流式，便于前端展示进度）。
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
    const bidding = new BiddingScreenshotService(db);
    const examples = new ScreenshotExampleService(db);
    const record = await bidding.getById(body.screenshotId);
    if (!record) return fail('not_found', '招投标记录不存在', 404);

    // 收集交付文档 + 附件中属于图片的文件（优先交付文档）。
    const imageFiles = [record.deliveryDocument, ...record.attachments]
      .flat()
      .filter((f): f is NonNullable<typeof f> => !!f && isImage(f.name, f.type));

    if (!imageFiles.length) {
      return fail('no_image', '该记录没有可学习的图片型交付文档（仅支持 png/jpg/jpeg/webp）', 422);
    }

    const customHeaders = HeaderUtils.extractForwardHeaders(request.headers);
    const client = new LLMClient(new Config({ timeout: 180_000 }), customHeaders);
    const learned: Array<{ assetId: string; name: string; result: VisionResult['screenshots'][number] | null; error?: string }> = [];

    for (const file of imageFiles.slice(0, 12)) {
      if (!file.assetId) continue;
      const assetId = file.assetId;
      const fileName = file.name || '截图';
      try {
        const resolved = await resolveAssetDownload(assetId);
        if (!resolved) {
          learned.push({ assetId, name: fileName, result: null, error: '附件未就绪' });
          continue;
        }
        const contentParts: ContentPart[] = [
          { type: 'text', text: '请分析这张招投标交付截图。' },
          { type: 'image_url', image_url: { url: resolved.signedUrl, detail: 'high' } },
        ];
        // 复用 buildMessages 取 system prompt，但把 user content 替换为多模态。
        const msgs = buildMessages({ scenario: 'bidding-vision', prompt: '请分析这张招投标交付截图。' });
        const messages: VisionMessage[] = [msgs[0], { role: 'user', content: contentParts }];

        let raw = '';
        for await (const part of client.stream(messages, {
          model: getModelForScenario('bidding-vision'),
          temperature: 0.1,
        })) {
          raw += part?.content?.toString?.() ?? '';
        }
        const parsed = safeParseVision(raw);
        const first = parsed?.screenshots?.[0] ?? null;
        if (first) {
          await examples.upsertFromVision({
            screenshotId: record.id,
            assetId,
            systemModule: first.systemModule,
            pagePath: first.pagePath,
            description: first.description,
            observedElements: first.observedElements ?? [],
            usableFor: first.usableFor ?? [],
          });
        }
        learned.push({ assetId, name: fileName, result: first });
      } catch (err) {
        learned.push({
          assetId,
          name: fileName,
          result: null,
          error: err instanceof Error ? err.message : '解析失败',
        });
      }
    }

    return ok({ total: imageFiles.length, learned });
  });
}

function isImage(name?: string | null, mime?: string | null): boolean {
  const m = (mime || '').toLowerCase();
  if (m.startsWith('image/')) return !m.includes('svg');
  const n = (name || '').toLowerCase();
  return /\.(png|jpe?g|webp|bmp|gif)$/.test(n);
}

function safeParseVision(raw: string): VisionResult | null {
  if (!raw) return null;
  // 去掉可能的 ```json 包裹
  const cleaned = raw.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  try {
    const obj = JSON.parse(cleaned) as VisionResult;
    if (obj && Array.isArray(obj.screenshots)) return obj;
  } catch {
    // 容错：截取第一个 { ... }
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1)) as VisionResult;
      } catch {
        return null;
      }
    }
  }
  return null;
}
