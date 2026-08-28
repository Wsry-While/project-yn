/**
 * 截图知识库 1.0 学习服务。
 *
 * 扫描全库历史招投标交付材料，逐张做多模态"参数级"视觉理解，
 * 把"这张图能证明哪些技术参数"沉淀到 screenshot_parameter_mappings，
 * 并写一条 knowledge_base_versions 版本记录。供截图作业指导书按参数召回参考图。
 *
 * 真实交付物形态：销售把多张截图贴在一个 Word 文档里（「XX截图项.docx」），
 * 因此候选来源有两类：
 *   1. docx 交付文档（delivery_document）—— 主力，用 mammoth 抽内嵌图片；
 *   2. 独立图片附件（attachments / delivery_document 是 png/jpg 等）—— 保留兼容。
 */
import { LLMClient, Config, HeaderUtils } from 'coze-coding-dev-sdk';
import type { SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import { ScreenshotExampleService } from './screenshot-example-service';
import { resolveAssetDownload } from './asset-access';
import { getChaoxingDirectDownloadUrl } from './chaoxing/file-tool';
import { getModelForScenario, buildMessages } from './llm-prompts';
import { extractImagesFromDocx, type ExtractedDocxImage } from './parse/docx-images';
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

interface LearnCandidate {
  record: BiddingScreenshot;
  /** 图片显示名 */  name: string;
  /** 已存在的 assetId（独立图片附件场景） */
  assetId?: string;
  /** docx 抽取出的图片 buffer（docx 场景，需上传换 assetId） */
  extracted?: ExtractedDocxImage;
  /** docx 源文件名，用于命名 */
  sourceDocName?: string;
  /** 这张图在 docx 中前文推断的参数标题 */
  contextHint?: string;
}

const DOCX_IMAGE_MAX_BYTES = 12 * 1024 * 1024; // 单张内嵌图上限，超过跳过（防超大位图）

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
   * 全库学习。
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

    // 2. 扫描候选
    const candidates = await this.collectImageCandidates();
    emit('step', {
      message: `扫描到 ${candidates.records} 条记录、${candidates.images.length} 张可学习图片（含 docx 抽取），开始逐图理解…`,
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
        // 2.1 准备 assetId：独立图片直接用；docx 抽取图需要上传到对象存储
        let assetId: string | null | undefined = img.assetId;
        if (!assetId && img.extracted) {
          assetId = await this.uploadExtractedImage(img);
        }
        if (!assetId) {
          failed++;
          log.push(`[skip] ${img.record.projectName} / ${img.name}: 无可用 assetId`);
          continue;
        }

        // 2.2 取可访问的图片 URL（对象存储签名）
        const resolved = await resolveAssetDownload(assetId);
        if (!resolved) {
          failed++;
          log.push(`[skip] ${img.record.projectName} / ${img.name}: 附件未就绪`);
          continue;
        }

        // 2.3 多模态视觉理解（带 docx 前文标题作为提示）
        const vision = await this.understandImage(client, resolved.signedUrl, {
          contextHint: img.contextHint,
          projectName: img.record.projectName,
          school: img.record.projectSchool,
        });
        if (!vision || vision.parameters.length === 0) {
          log.push(`[warn] ${img.record.projectName} / ${img.name}: 未识别到参数`);
          emit('delta', {
            content: `▸ (${processed}/${candidates.images.length}) ${img.name}：未识别到参数\n`,
          });
          continue;
        }

        // 2.4 upsert 截图示例
        const exampleId = await this.examples.upsertFromVision({
          screenshotId: img.record.id,
          assetId,
          systemModule: vision.systemModule,
          pagePath: vision.pagePath,
          description: vision.description,
          observedElements: vision.parameters.flatMap((p) => p.evidenceElements),
          usableFor: vision.parameters.map((p) => p.name),
        });

        // 2.5 写参数映射
        const ids = await this.examples.upsertParameterMappings(
          vision.parameters.map((p) => ({
            exampleId,
            assetId,
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
   * 收集全库可学习图片：
   *  - docx 交付文档：下载并抽取内嵌图片（主力）；
   *  - 独立图片附件/交付图：直接用 assetId。
   *
   * 直接 select('*') 拿到的是数据库下划线字段（delivery_document / attachments），
   * 这里做一次轻量归一，避免依赖业务 mapper。
   */
  private async collectImageCandidates(): Promise<{
    records: number;
    images: LearnCandidate[];
  }> {
    const pageSize = 500;
    let from = 0;
    const all: Array<{
      id: string;
      project_name: string | null;
      project_school: string | null;
      delivery_document: BiddingFileRef | null;
      attachments: BiddingFileRef[] | null;
    }> = [];
    while (true) {
      const { data, error } = await this.db
        .from('bidding_screenshots')
        .select('id, project_name, project_school, delivery_document, attachments')
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .range(from, from + pageSize - 1);
      if (error) throw error;
      const rows = (data ?? []) as typeof all;
      all.push(...rows);
      if (rows.length < pageSize) break;
      from += pageSize;
    }

    const images: LearnCandidate[] = [];
    const seenAsset = new Set<string>();
    const seenHash = new Set<string>();
    // 单次学习的图片上限：全库可能有上千张图，逐张走多模态耗时极长，
    // 默认取最近 500 张（按 created_at desc 已优先新记录）。可用环境变量调大。
    const maxImages = Number(process.env.KB_LEARN_MAX_IMAGES ?? 500);

    for (const row of all) {
      // 归一为 BiddingScreenshot 形态供后续复用（id/projectName/projectSchool/deliveryDocument/attachments）
      const record = {
        id: row.id,
        projectName: row.project_name,
        projectSchool: row.project_school,
        deliveryDocument: row.delivery_document,
        attachments: row.attachments ?? [],
      } as unknown as BiddingScreenshot;

      // 1) docx 交付文档 —— 抽内嵌图
      const dd = row.delivery_document;
      if (dd && isDocx(dd.name)) {
        try {
          const extracted = await this.fetchAndExtractDocx(dd, record);
          for (const img of extracted) {
            // 跨 docx 内容去重：相同截图（同 hash）只学一次
            if (seenHash.has(img.contentHash)) continue;
            seenHash.add(img.contentHash);
            images.push({
              record,
              name: `${dd.name || '截图文档'}#${img.index + 1}`,
              sourceDocName: dd.name || undefined,
              extracted: img,
              contextHint: img.contextHint,
            });
          }
        } catch (err) {
          console.warn('[kb-learn] docx 抽取失败:', row.project_name, err);
        }
      }

      // 2) 独立图片：交付文档本身就是图片，或附件里的图片
      const standalone = [row.delivery_document, ...(row.attachments ?? [])]
        .flat()
        .filter((f): f is NonNullable<BiddingFileRef> => !!f && isImage(f.name, f.type));
      for (const f of standalone) {
        if (f.assetId && !seenAsset.has(f.assetId)) {
          seenAsset.add(f.assetId);
          images.push({ record, assetId: f.assetId, name: f.name || '截图' });
        }
      }

      if (images.length >= maxImages) break;
    }

    if (images.length > maxImages) images.length = maxImages;
    return { records: all.length, images };
  }

  /**
   * 下载 docx（assetId 走对象存储；否则用 delivery_document.url 超星直链），
   * 并抽取其中内嵌图片。
   */
  private async fetchAndExtractDocx(
    file: BiddingFileRef,
    record: BiddingScreenshot,
  ): Promise<ExtractedDocxImage[]> {
    let arrayBuffer: ArrayBuffer | null = null;

    if (file.assetId) {
      const resolved = await resolveAssetDownload(file.assetId);
      if (resolved) {
        const r = await fetch(resolved.signedUrl, { redirect: 'follow' });
        if (r.ok) arrayBuffer = await r.arrayBuffer();
      }
    }
    if (!arrayBuffer) {
      // 超星直链（storageStatus=direct，无 assetId）。
      // 裸 url（d0.cldisk.com/download/{objectId}）会被 CDN 403，必须现换签名，
      // 且下载时必须带 office.chaoxing.com 的 Referer，否则 CDN 边缘拒绝。
      const objectId = file.objectId || extractObjectIdFromUrl(file.url);
      if (objectId && /^[a-f0-9]{32}$/i.test(objectId)) {
        const direct = await getChaoxingDirectDownloadUrl(objectId);
        if (direct?.url) {
          const r = await fetch(direct.url, {
            redirect: 'follow',
            headers: {
              'User-Agent': CHAOXING_UA,
              'Referer': 'https://office.chaoxing.com/',
            },
          });
          if (r.ok) arrayBuffer = await r.arrayBuffer();
        }
      } else if (file.url && /^https?:\/\//i.test(file.url)) {
        const r = await fetch(file.url, {
          redirect: 'follow',
          headers: { 'User-Agent': CHAOXING_UA },
        });
        if (r.ok) arrayBuffer = await r.arrayBuffer();
      }
    }
    if (!arrayBuffer) return [];

    // docx 本质是 zip（PK\x03\x04 开头）。超星偶发返回 HTML 错误页或截断文件，
    // 先校验魔数，避免 mammoth 抛 "Can't find end of central directory" 噪声错误。
    const head = new Uint8Array(arrayBuffer, 0, Math.min(4, arrayBuffer.byteLength));
    const isZip = head[0] === 0x50 && head[1] === 0x4b && (head[2] === 0x03 || head[2] === 0x05);
    if (!isZip) {
      console.warn('[kb-learn] docx 不是有效 zip（可能下载到错误页或文件损坏），跳过:', file.name, arrayBuffer.byteLength, 'bytes');
      return [];
    }

    const images = await extractImagesFromDocx(arrayBuffer, {
      projectName: record.projectName,
    });
    return images.filter((img) => img.buffer.length > 0 && img.buffer.length <= DOCX_IMAGE_MAX_BYTES);
  }

  /**
   * 把 docx 抽出的内嵌图片上传到对象存储，写 external_file_assets，返回 assetId。
   * 按 (source='kb-docx', object_id=contentHash) 幂等，重复学习不重复上传。
   */
  private async uploadExtractedImage(img: LearnCandidate): Promise<string | null> {
    if (!img.extracted) return null;
    const ex = img.extracted;
    const objectId = `kb/${ex.contentHash}`;

    // 幂等：已上传过则直接复用
    const { data: existing } = await this.db
      .from('external_file_assets')
      .select('id')
      .eq('source', 'kb-docx')
      .eq('object_id', objectId)
      .limit(1)
      .maybeSingle();
    if (existing?.id) return existing.id as string;

    const bucket = process.env.STORAGE_BUCKET || 'bidding-attachments';
    const ext = ex.ext === 'jpeg' ? 'jpg' : ex.ext;
    const storageKey = `kb-docx/${ex.contentHash}.${ext}`;
    const fileName = img.sourceDocName
      ? `${img.sourceDocName.replace(/\.[^.]+$/, '')}_${ex.index + 1}.${ext}`
      : `kb-${ex.contentHash}.${ext}`;
    const contentType = ex.contentType || `image/${ext}`;

    const { error: uploadErr } = await this.db.storage
      .from(bucket)
      .upload(
        storageKey,
        new Blob([new Uint8Array(ex.buffer)], { type: contentType }),
        { contentType, upsert: false },
      );
    if (uploadErr) {
      // 已存在（并发/重复）视为成功
      if (!/Duplicate|already exists/i.test(uploadErr.message)) {
        throw new Error(`上传抽图失败: ${uploadErr.message}`);
      }
    }

    const now = new Date().toISOString();
    const { data, error: insertErr } = await this.db
      .from('external_file_assets')
      .insert({
        id: randomUUID(),
        source: 'kb-docx',
        object_id: objectId,
        source_url: null,
        file_name: fileName,
        suffix: ext,
        content_type: contentType,
        byte_size: ex.buffer.length,
        status: 'stored',
        bucket,
        storage_key: storageKey,
        error_message: null,
        retry_count: 0,
        created_at: now,
        updated_at: now,
      } as never)
      .select('id')
      .single();
    if (insertErr) {
      // 唯一冲突时回查
      if (/duplicate key|unique/i.test(insertErr.message)) {
        const { data: d } = await this.db
          .from('external_file_assets')
          .select('id')
          .eq('source', 'kb-docx')
          .eq('object_id', objectId)
          .maybeSingle();
        return (d?.id as string) ?? null;
      }
      throw new Error(`写抽图元数据失败: ${insertErr.message}`);
    }
    return (data as { id: string }).id;
  }

  /**
   * 对单张图片做参数级视觉理解。
   */
  private async understandImage(
    client: LLMClient,
    signedUrl: string,
    ctx?: { contextHint?: string; projectName?: string | null; school?: string | null },
  ): Promise<ParamVisionResult | null> {
    const hintLines = [
      '请分析这张招投标产品交付截图，识别它能证明哪些具体技术参数/功能点。',
    ];
    if (ctx?.contextHint) {
      hintLines.push(`该截图在交付文档中紧接的标题/参数说明是：「${ctx.contextHint}」，请据此判断它对应的功能点。`);
    }
    if (ctx?.projectName) hintLines.push(`所属项目：${ctx.projectName}`);
    const prompt = hintLines.join('\n');

    const contentParts: ContentPart[] = [
      { type: 'text', text: prompt },
      { type: 'image_url', image_url: { url: signedUrl, detail: 'high' } },
    ];
    const msgs = buildMessages({ scenario: 'bidding-vision-param', prompt });
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

function isDocx(name?: string | null): boolean {
  return /\.(docx)$/i.test(name || '');
}

function extractObjectIdFromUrl(url?: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url, 'http://x');
    const q = u.searchParams.get('objectid') || u.searchParams.get('objectId');
    if (q && /^[a-f0-9]{32}$/i.test(q)) return q;
  } catch {
    /* ignore */
  }
  const m = url.match(/([a-f0-9]{32})/i);
  return m ? m[1] : null;
}

const CHAOXING_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

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
