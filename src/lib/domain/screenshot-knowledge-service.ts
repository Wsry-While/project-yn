/**
 * 截图知识库 1.0 学习服务。
 *
 * 扫描全库历史招投标交付图片，逐张做多模态"参数级"视觉理解，
 * 把"这张图能证明哪些技术参数"沉淀到 screenshot_parameter_mappings，
 * 并写一条 knowledge_base_versions 版本记录。供截图作业指导书按参数召回参考图。
 */
import { LLMClient, Config, HeaderUtils } from 'coze-coding-dev-sdk';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ScreenshotExampleService } from './screenshot-example-service';
import { resolveAssetDownload } from './asset-access';
import { getModelForScenario, buildMessages } from './llm-prompts';
import type { BiddingScreenshot, BiddingFileRef } from './types';

interface ContentPart {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: { url: string; detail?: 'high' | 'low' };
}
interface VisionMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | ContentPart[];
}

export interface ParamVisionResult {
  systemModule: string | null;
  pagePath: string | null;
  description: string | null;
  parameters: Array<{
    name: string;
    evidenceElements: string[];
    note: string;
    confidence: number;
  }>;
}

export type LearnProgress = (
  type: 'step' | 'delta' | 'done' | 'error' | 'meta',
  payload: unknown,
) => void;

export class ScreenshotKnowledgeService {
  private readonly examples: ScreenshotExampleService;

  constructor(private readonly db: SupabaseClient) {
    this.examples = new ScreenshotExampleService(db);
  }

  /** 当前最新就绪版本 */
  async getLatestVersion(): Promise<{
    version: string;
    totalImages: number;
    totalMappings: number;
    finishedAt: string | null;
  } | null> {
    const { data } = await this.db
      .from('knowledge_base_versions')
      .select('version,total_images,total_mappings,finished_at')
      .eq('status', 'ready')
      .order('finished_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!data) return null;
    return {
      version: data.version as string,
      totalImages: Number(data.total_images ?? 0),
      totalMappings: Number(data.total_mappings ?? 0),
      finishedAt: (data.finished_at as string | null) ?? null,
    };
  }

  /**
   * 全库学习：扫描所有未删除、且含图片型交付附件的招投标记录，逐图理解。
   * SSE 推送进度，完成后写版本记录。
   */
  async learnAll(
    actor: { id: string; name: string },
    emit: LearnProgress,
    requestHeaders?: Headers,
  ): Promise<void> {
    const startedAt = new Date();
    const version = `1.${formatVersionTs(startedAt)}`;

    // 1. 创建版本记录（learning）
    const { data: versionRow, error: verErr } = await this.db
      .from('knowledge_base_versions')
      .insert({
        version,
        status: 'learning',
        total_records: 0,
        total_images: 0,
        total_mappings: 0,
        failed_images: 0,
        learned_by: actor.id,
        learned_by_name: actor.name,
        started_at: startedAt.toISOString(),
      })
      .select('id')
      .single();
    if (verErr) throw new Error(`创建知识库版本失败: ${verErr.message}`);
    const versionId = versionRow.id as string;

    emit('meta', { version, startedAt: startedAt.toISOString() });

    // 2. 扫描候选图片
    const candidates = await this.collectImageCandidates();
    emit('step', {
      message: `扫描到 ${candidates.records} 条记录、${candidates.images.length} 张可学习图片，开始逐图理解…`,
    });

    const customHeaders = requestHeaders
      ? HeaderUtils.extractForwardHeaders(requestHeaders)
      : undefined;
    const client = new LLMClient(new Config({ timeout: 120_000 }), customHeaders);

    let processed = 0;
    let mappingCount = 0;
    let failed = 0;
    const log: string[] = [];

    for (const img of candidates.images) {
      processed++;
      try {
        if (!img.assetId) {
          failed++;
          log.push(`[skip] ${img.record.projectName} / ${img.name}: 无 assetId`);
          continue;
        }
        const resolved = await resolveAssetDownload(img.assetId);
        if (!resolved) {
          failed++;
          log.push(`[skip] ${img.record.projectName} / ${img.name}: 附件未就绪`);
          continue;
        }

        const vision = await this.understandImage(client, resolved.signedUrl);
        if (!vision || vision.parameters.length === 0) {
          log.push(`[warn] ${img.record.projectName} / ${img.name}: 未识别到参数`);
          continue;
        }

        // upsert 截图示例
        const exampleId = await this.examples.upsertFromVision({
          screenshotId: img.record.id,
          assetId: img.assetId,
          systemModule: vision.systemModule,
          pagePath: vision.pagePath,
          description: vision.description,
          observedElements: vision.parameters.flatMap((p) => p.evidenceElements),
          usableFor: vision.parameters.map((p) => p.name),
        });

        // 写参数映射
        const ids = await this.examples.upsertParameterMappings(
          vision.parameters.map((p) => ({
            exampleId,
            assetId: img.assetId,
            sourceRecordId: img.record.id,
            parameterName: p.name,
            systemModule: vision.systemModule,
            visionNote: p.note,
            evidenceElements: p.evidenceElements,
            confidence: p.confidence,
            kbVersion: version,
          })),
        );
        mappingCount += ids.length;

        emit('delta', {
          content: `▸ (${processed}/${candidates.images.length}) ${img.record.projectName} / ${img.name}：识别 ${vision.parameters.length} 个参数（${vision.parameters.map((p) => p.name).join('、')}）\n`,
        });
      } catch (err) {
        failed++;
        const msg = err instanceof Error ? err.message : String(err);
        log.push(`[error] ${img.record.projectName} / ${img.name}: ${msg}`);
        emit('delta', {
          content: `▸ (${processed}/${candidates.images.length}) ${img.name} 学习失败：${msg}\n`,
        });
      }

      // 每 10 张更新一次版本计数
      if (processed % 10 === 0) {
        await this.db
          .from('knowledge_base_versions')
          .update({
            total_records: candidates.records,
            total_images: processed,
            total_mappings: mappingCount,
            failed_images: failed,
          })
          .eq('id', versionId);
      }
    }

    // 3. 完成版本记录
    const finishedAt = new Date();
    const { error: finishErr } = await this.db
      .from('knowledge_base_versions')
      .update({
        status: 'ready',
        total_records: candidates.records,
        total_images: processed,
        total_mappings: mappingCount,
        failed_images: failed,
        finished_at: finishedAt.toISOString(),
        log: log.slice(-200).join('\n').slice(0, 20000),
      })
      .eq('id', versionId);
    if (finishErr) console.error('[kb-learn] 完成版本更新失败:', finishErr);

    emit('done', {
      version,
      totalImages: processed,
      totalMappings: mappingCount,
      failedImages: failed,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
    });
  }

  /**
   * 收集全库含图片型交付附件的招投标记录（含交付文档与附件）。
   */
  private async collectImageCandidates(): Promise<{
    records: number;
    images: Array<{ record: BiddingScreenshot; assetId: string; name: string }>;
  }> {
    // 分页拉取所有未删除记录
    const pageSize = 500;
    let from = 0;
    const all: BiddingScreenshot[] = [];
    while (true) {
      const { data, error } = await this.db
        .from('bidding_screenshots')
        .select('*')
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .range(from, from + pageSize - 1);
      if (error) throw error;
      const rows = (data ?? []) as unknown as BiddingScreenshot[];
      all.push(...rows);
      if (rows.length < pageSize) break;
      from += pageSize;
    }

    const images: Array<{ record: BiddingScreenshot; assetId: string; name: string }> = [];
    for (const record of all) {
      const files = [record.deliveryDocument, ...(record.attachments ?? [])]
        .flat()
        .filter((f): f is NonNullable<BiddingFileRef> => !!f && isImage(f.name, f.type));
      for (const f of files) {
        if (f.assetId) {
          images.push({ record, assetId: f.assetId, name: f.name || '截图' });
        }
      }
    }
    return { records: all.length, images };
  }

  /**
   * 对单张图片做参数级视觉理解。
   */
  private async understandImage(
    client: LLMClient,
    signedUrl: string,
  ): Promise<ParamVisionResult | null> {
    const contentParts: ContentPart[] = [
      { type: 'text', text: '请分析这张招投标产品交付截图，识别它能证明哪些具体技术参数/功能点。' },
      { type: 'image_url', image_url: { url: signedUrl, detail: 'high' } },
    ];
    const msgs = buildMessages({
      scenario: 'bidding-vision-param',
      prompt: '请分析这张招投标产品交付截图，识别它能证明哪些具体技术参数/功能点。',
    });
    const messages: VisionMessage[] = [msgs[0], { role: 'user', content: contentParts }];

    let raw = '';
    for await (const part of client.stream(messages, {
      model: getModelForScenario('bidding-vision-param'),
      temperature: 0.1,
    })) {
      raw += part?.content?.toString?.() ?? '';
    }
    return safeParseParamVision(raw);
  }
}

function isImage(name?: string | null, mime?: string | null): boolean {
  const m = (mime || '').toLowerCase();
  if (m.startsWith('image/')) return !m.includes('svg');
  const n = (name || '').toLowerCase();
  return /\.(png|jpe?g|webp|bmp|gif)$/.test(n);
}

function safeParseParamVision(raw: string): ParamVisionResult | null {
  if (!raw) return null;
  const cleaned = raw.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  const tryParse = (s: string): ParamVisionResult | null => {
    try {
      const obj = JSON.parse(s) as Record<string, unknown>;
      if (obj && Array.isArray(obj.parameters)) {
        return {
          systemModule: (obj.systemModule as string | null) ?? null,
          pagePath: (obj.pagePath as string | null) ?? null,
          description: (obj.description as string | null) ?? null,
          parameters: (obj.parameters as unknown[])
            .filter((p): p is Record<string, unknown> => !!p && typeof p === 'object')
            .map((p) => ({
              name: String(p.name ?? '').trim().slice(0, 100),
              evidenceElements: Array.isArray(p.evidenceElements)
                ? (p.evidenceElements as unknown[]).map((e) => String(e)).slice(0, 10)
                : [],
              note: String(p.note ?? '').slice(0, 200),
              confidence: clampConfidence(p.confidence),
            }))
            .filter((p) => p.name.length > 0),
        };
      }
    } catch {
      return null;
    }
    return null;
  };
  const parsed = tryParse(cleaned);
  if (parsed) return parsed;
  // 容错：截取第一个 { ... }
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start >= 0 && end > start) return tryParse(cleaned.slice(start, end + 1));
  return null;
}

function clampConfidence(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return 0.5;
  return Math.max(0, Math.min(1, n));
}

function formatVersionTs(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}`;
}
