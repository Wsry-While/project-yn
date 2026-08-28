/**
 * 招投标截图示例库服务（闭环学习产物）。
 *
 * 交付文档上传/解析后，把"这张截图展示了哪个系统页面、包含哪些要素"沉淀为
 * 结构化示例，供后续生成截图建议时按类别/标签检索召回。
 * 超过 30 天的示例标记 stale（系统界面可能已变更），仅作参考、需人工复核。
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export interface ScreenshotExample {
  id: string;
  screenshotId: string | null;
  assetId: string | null;
  systemModule: string | null;
  pagePath: string | null;
  description: string | null;
  observedElements: string[];
  tags: string[];
  stale: boolean;
  source: string;
  createdAt: string;
  // 关联的业务快照（检索结果回填，便于前端展示/跳转）
  school?: string | null;
  projectName?: string | null;
  salesManager?: string | null;
}

interface ExampleRow {
  id: string;
  screenshot_id: string | null;
  asset_id: string | null;
  system_module: string | null;
  page_path: string | null;
  description: string | null;
  observed_elements: string[] | null;
  tags: string[] | null;
  stale: boolean;
  source: string;
  created_at: string;
}

export interface ParameterMapping {
  id: string;
  exampleId: string;
  assetId: string | null;
  sourceRecordId: string | null;
  parameterKey: string;
  parameterName: string;
  systemModule: string | null;
  visionNote: string | null;
  evidenceElements: string[];
  confidence: number;
  kbVersion: string;
  createdAt: string;
  /** 示例图存储路径（从 examples 表回填） */
  storagePath?: string | null;
  // 回填，便于前端展示
  example?: ScreenshotExample | null;
}

interface ParameterMappingRow extends Record<string, unknown> {
  id: string;
  example_id: string;
  asset_id: string | null;
  source_record_id: string | null;
  parameter_key: string;
  parameter_name: string;
  system_module: string | null;
  vision_note: string | null;
  evidence_elements: string[] | null;
  confidence: number;
  kb_version: string;
  created_at: string;
}

const STALE_DAYS = 30;

export class ScreenshotExampleService {
  constructor(private readonly db: SupabaseClient) {}

  /** 把全表超过 30 天的示例标记为 stale。可在召回前调用以保证新鲜度。 */
  async refreshStale(): Promise<void> {
    const cutoff = new Date(Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000).toISOString();
    await this.db
      .from('bidding_screenshot_examples')
      .update({ stale: true, updated_at: new Date().toISOString() })
      .lt('created_at', cutoff)
      .eq('stale', false);
  }

  /**
   * 按关键词/类别检索历史示例。
   * @param keywords 评分项名称/关键词，用于匹配 tags/description/system_module
   * @param limit 返回条数
   */
  async search(keywords: string[], limit = 8): Promise<ScreenshotExample[]> {
    await this.refreshStale();
    let q = this.db
      .from('bidding_screenshot_examples')
      .select(
        `id,screenshot_id,asset_id,system_module,page_path,description,observed_elements,tags,stale,source,created_at,
         bidding_screenshots(project_name,project_school,sales_manager)`,
      )
      .order('created_at', { ascending: false })
      .limit(limit * 3);

    // 关键词过滤：用 tags 包含任一关键词或 description ilike。Supabase 对数组用 cs/ov。
    const ors: string[] = [];
    for (const kw of keywords.filter(Boolean).slice(0, 6)) {
      const safe = kw.replace(/[,()]/g, ' ').trim();
      if (safe) ors.push(`description.ilike.%${safe}%,system_module.ilike.%${safe}%`);
    }
    if (ors.length) q = q.or(ors.join(','));

    const { data, error } = await q;
    if (error) throw error;
    const rows = (data ?? []) as Array<ExampleRow & { bidding_screenshots?: unknown }>;

    return rows.slice(0, limit).map((r) => {
      const biz = (r.bidding_screenshots as
        | { project_name?: string; project_school?: string; sales_manager?: string }
        | null) || {
        project_name: null,
        project_school: null,
        sales_manager: null,
      };
      return {
        id: r.id,
        screenshotId: r.screenshot_id,
        assetId: r.asset_id,
        systemModule: r.system_module,
        pagePath: r.page_path,
        description: r.description,
        observedElements: r.observed_elements ?? [],
        tags: r.tags ?? [],
        stale: r.stale,
        source: r.source,
        createdAt: r.created_at,
        projectName: biz.project_name ?? null,
        school: biz.project_school ?? null,
        salesManager: biz.sales_manager ?? null,
      };
    });
  }

  async upsertFromVision(input: {
    screenshotId: string;
    assetId: string;
    systemModule: string | null;
    pagePath: string | null;
    description: string | null;
    observedElements: string[];
    usableFor: string[];
  }): Promise<string> {
    const now = new Date().toISOString();
    // 同一 screenshot + asset 幂等
    const { data: existing } = await this.db
      .from('bidding_screenshot_examples')
      .select('id')
      .eq('screenshot_id', input.screenshotId)
      .eq('asset_id', input.assetId)
      .maybeSingle();

    const row = {
      screenshot_id: input.screenshotId,
      asset_id: input.assetId,
      system_module: input.systemModule,
      page_path: input.pagePath,
      description: input.description,
      observed_elements: input.observedElements,
      tags: input.usableFor,
      stale: false,
      updated_at: now,
    };
    if (existing) {
      await this.db.from('bidding_screenshot_examples').update(row).eq('id', existing.id);
      return existing.id as string;
    }
    const { data, error } = await this.db
      .from('bidding_screenshot_examples')
      .insert({ ...row, source: 'delivery_doc', created_at: now })
      .select('id')
      .single();
    if (error) throw error;
    return data.id as string;
  }

  /**
   * 把视觉理解得到的"参数↔图片映射"批量写入（按 example_id + parameter_key 幂等）。
   * 返回写入的 mapping id 列表。
   */
  async upsertParameterMappings(
    input: Array<{
      exampleId: string;
      assetId: string | null;
      sourceRecordId: string | null;
      parameterName: string;
      systemModule: string | null;
      visionNote: string | null;
      evidenceElements: string[];
      confidence: number;
      kbVersion?: string;
    }>,
  ): Promise<string[]> {
    const ids: string[] = [];
    for (const item of input) {
      const parameterKey = normalizeParameterKey(item.parameterName, item.systemModule);
      if (!parameterKey) continue;
      const row = {
        example_id: item.exampleId,
        asset_id: item.assetId,
        source_record_id: item.sourceRecordId,
        parameter_key: parameterKey,
        parameter_name: item.parameterName.trim().slice(0, 100),
        system_module: item.systemModule,
        vision_note: item.visionNote,
        evidence_elements: item.evidenceElements ?? [],
        confidence: Math.max(0, Math.min(1, item.confidence ?? 0.5)),
        kb_version: item.kbVersion ?? '1.0',
        updated_at: new Date().toISOString(),
      };
      const { data: existing } = await this.db
        .from('screenshot_parameter_mappings')
        .select('id')
        .eq('example_id', item.exampleId)
        .eq('parameter_key', parameterKey)
        .maybeSingle();
      if (existing) {
        await this.db.from('screenshot_parameter_mappings').update(row).eq('id', existing.id);
        ids.push(existing.id as string);
      } else {
        const { data, error } = await this.db
          .from('screenshot_parameter_mappings')
          .insert(row)
          .select('id')
          .single();
        if (error) throw error;
        ids.push(data.id as string);
      }
    }
    return ids;
  }

  /**
   * 按参数名/关键词召回参考图映射（Top N），按 confidence 排序。
   * 同时做 parameter_key 精确匹配 + 关键词 ilike 模糊匹配。
   */
  async searchByParameter(
    keywords: string[],
    opts: { limit?: number; kbVersion?: string } = {},
  ): Promise<ParameterMapping[]> {
    const limit = opts.limit ?? 5;
    const key = normalizeParameterKey(keywords.join(' '), null);

    let q = this.db
      .from('screenshot_parameter_mappings')
      .select(
        `id,example_id,asset_id,source_record_id,parameter_key,parameter_name,system_module,vision_note,evidence_elements,confidence,kb_version,created_at`,
      )
      .order('confidence', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(limit * 3);

    if (opts.kbVersion) q = q.eq('kb_version', opts.kbVersion);

    // 优先 parameter_key 精确匹配；再用归一化关键词做 parameter_key 子串匹配，
    // 缓解「知识图谱支持AI生成功能」(item) vs 「AI知识图谱生成」(vision) 的措辞差异。
    const ors: string[] = [];
    if (key) ors.push(`parameter_key.eq.${key}`);
    const keyHints = keywords
      .map((k) => normalizeParameterKey(k, null))
      .filter((k) => k.length >= 2);
    for (const kh of keyHints.slice(0, 6)) {
      ors.push(`parameter_key.ilike.%${kh}%`);
    }
    for (const kw of keywords.filter(Boolean).slice(0, 6)) {
      const safe = kw.replace(/[,()（）、，]/g, ' ').trim();
      if (safe.length >= 2) {
        ors.push(`parameter_name.ilike.%${safe}%`);
        ors.push(`vision_note.ilike.%${safe}%`);
      }
    }
    if (ors.length) q = q.or(ors.join(','));

    const { data, error } = await q;
    if (error) throw error;
    const rows = (data ?? []) as unknown as ParameterMappingRow[];

    // 去重：同一 asset 只保留 confidence 最高的一条
    const byAsset = new Map<string, ParameterMapping>();
    for (const r of rows) {
      const assetKey = r.asset_id ?? r.example_id;
      const cur = byAsset.get(assetKey);
      if (!cur || Number(r.confidence) > cur.confidence) {
        byAsset.set(assetKey, {
          id: r.id,
          exampleId: r.example_id,
          assetId: r.asset_id,
          sourceRecordId: r.source_record_id,
          parameterKey: r.parameter_key,
          parameterName: r.parameter_name,
          systemModule: r.system_module,
          visionNote: r.vision_note,
          evidenceElements: r.evidence_elements ?? [],
          confidence: Number(r.confidence),
          kbVersion: r.kb_version,
          createdAt: r.created_at,
          storagePath: null,
        });
      }
    }
    return Array.from(byAsset.values()).slice(0, limit);
  }
}

/**
 * 把参数名归一化为稳定的 parameter_key：
 * 去 ▲★●、标点、空白、"支持/提供/具备"等冗余前缀，转小写。
 * 若带 systemModule，前缀拼接以降低跨模块重名（如多个模块都有"列表查询"）。
 */
export function normalizeParameterKey(name: string, systemModule: string | null): string {
  if (!name) return '';
  const stripPrefix = (s: string) =>
    s
      .replace(/^[▲★●＊*＊\s]+/g, '')
      .replace(/^(支持|提供|具备|可|能够|可以|实现|拥有|含|包括)\s*/g, '')
      .trim();
  const core = stripPrefix(name)
    .replace(/[\s，,。.；;：:、（）()【】\[\]"'""''！!？?\/\\\-—_·]/g, '')
    .toLowerCase();
  if (!core) return '';
  if (systemModule) {
    const mod = systemModule
      .replace(/[\s，,。.；;：:、（）()【】\[\]"'""''\/\\\-—_·]/g, '')
      .toLowerCase()
      .slice(0, 20);
    if (mod) return `${mod}:${core}`;
  }
  return core;
}
