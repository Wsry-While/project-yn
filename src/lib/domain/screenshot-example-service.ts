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
}
