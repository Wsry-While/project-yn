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

/** 一条参数对应的整组参考截图（来自同一交付文档同一 ▲ 小节，按文档顺序） */
export interface ReferenceGroup {
  groupId: string;
  /** 参数小节标题（历史交付文档中的原句） */
  sectionTitle: string;
  /** 组内图片数量 */
  imageCount: number;
  /** 相关度得分 */
  score: number;
  /** 来源记录快照 */
  sourceRecordId: string | null;
  sourceProjectName: string | null;
  sourceSchool: string | null;
  /** 组内图片，按文档顺序排列 */
  assets: Array<{
    assetId: string;
    seq: number;
    visionNote: string | null;
  }>;
}

interface GroupRow {
  id: string;
  record_id: string;
  section_title: string;
  image_count: number;
  kb_version: string | null;
  project_name?: string | null;
  project_school?: string | null;
}

interface GroupAssetRow {
  group_id: string;
  asset_id: string;
  seq: number;
}

const STALE_DAYS = 30;

export class ScreenshotExampleService {
  constructor(private readonly db: SupabaseClient) {}

  /**
   * 分块查询资产状态（stored/direct 可预览）。assetId 数量可能达上百个（UUID 各 36 字符），
   * 一次性 .in('id', ids) 会把 URL 撑爆（现网 `URI too long`），因此按 CHUNK_IN 分块并集。
   */
  private async fetchUsableAssetIds(assetIds: string[]): Promise<Set<string>> {
    const usable = new Set<string>();
    const uniq = Array.from(new Set(assetIds));
    const CHUNK_IN = 40;
    for (let i = 0; i < uniq.length; i += CHUNK_IN) {
      const slice = uniq.slice(i, i + CHUNK_IN);
      const { data, error } = await this.db
        .from('external_file_assets')
        .select('id,status')
        .in('id', slice);
      if (error) throw error;
      for (const a of (data ?? []) as Array<{ id: string; status: string }>) {
        if (a.status === 'stored' || a.status === 'direct') usable.add(a.id);
      }
    }
    return usable;
  }

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
    if (ors.length) q = q.or(ors.slice(0, 24).join(','));

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
   * 按参数名/关键词召回参考图映射（Top N），按相关度 + confidence 排序。
   *
   * 召回不强制按 kb_version 过滤：知识库版本是每次「全库学习」滚动生成的，
   * 评分项生成时拿到的 latestReady 版本号与 mappings 里实际写入的版本经常错位
   * （历史 404 时代的 ready 版本下一条映射都没有），按版本硬过滤会直接 0 命中。
   * 这里跨所有版本召回，让最新、最高置信度的映射自然排在前面。opts.kbVersion
   * 仅作为同分时的优先版本（可空）。
   */
  async searchByParameter(
    keywords: string[],
    opts: { limit?: number; kbVersion?: string } = {},
  ): Promise<ParameterMapping[]> {
    const limit = opts.limit ?? 5;

    // 1) 把评分项标题/关键词拆成「系统模块词 + 功能词」，用于 ilike 召回。
    //    评分项形如「知识图谱支持课程章节一键转化」，视觉库 parameter_key 形如
    //    「知识图谱:课程章节一键转化生成知识图谱」，整句匹配不上，拆成功能短语才能命中。
    const terms = extractMatchTerms(keywords);

    let q = this.db
      .from('screenshot_parameter_mappings')
      .select(
        `id,example_id,asset_id,source_record_id,parameter_key,parameter_name,system_module,vision_note,evidence_elements,confidence,kb_version,created_at`,
      )
      .order('confidence', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(limit * 20);

    // 注意：不按 kb_version 硬过滤（见方法注释）。

    // 2) 组装 OR 召回条件：模块别名命中 system_module/parameter_key（宁多勿滥，打分阶段再归一精确判定），
    //    功能词命中 parameter_key/parameter_name；vision_note 权重最低，用最短的词兜底。
    const ors: string[] = [];
    for (const mod of terms.modules) {
      for (const alias of MODULE_ALIASES[mod] ?? [mod]) {
        const a = alias.toLowerCase().replace(/\s/g, '');
        if (a.length >= 2) {
          ors.push(`system_module.ilike.%${a}%`);
          ors.push(`parameter_key.ilike.%${a}%`);
        }
      }
    }
    for (const fn of terms.functions) {
      ors.push(`parameter_key.ilike.%${fn}%`);
      ors.push(`parameter_name.ilike.%${fn}%`);
    }
    // 具体参数名词（主导信号）命中 key/name
    for (const p of terms.params) {
      ors.push(`parameter_key.ilike.%${p}%`);
      ors.push(`parameter_name.ilike.%${p}%`);
      ors.push(`vision_note.ilike.%${p}%`);
    }
    // 弱领域词仅用于拉宽召回，打分阶段不计入 paramHit
    for (const w of terms.weak) {
      ors.push(`parameter_name.ilike.%${w}%`);
    }
    // 原始关键词（去掉标点）在 parameter_name 上兜底。注意：超长关键词（如评分项
    // requirement 原文可到数百字）绝不能整句塞进 ilike OR——PostgREST 的 .or() 拼 URL，
    // 会触发 `URI too long`（线上已现网报错）。这里统一走 clipIlKeywords 截成短词，长文
    // 的语义已由 extractMatchTerms 的词袋承担，原文兜底只补短句命中。
    for (const kw of clipIlKeywords(keywords)) {
      const safe = kw.replace(/[,()（）、，:：]/g, ' ').trim();
      if (safe.length >= 2 && !terms.functions.includes(safe.toLowerCase())) {
        ors.push(`parameter_name.ilike.%${safe}%`);
      }
    }
    if (ors.length) q = q.or(ors.slice(0, 24).join(','));

    const { data, error } = await q;
    if (error) throw error;
    const rawRows = (data ?? []) as unknown as ParameterMappingRow[];

    // 2.5) 过滤掉预览不可用的坏资产（stored/direct 之外，如原始文件缺失的 failed）。
    //      mapping.asset_id 指向 external_file_assets；批量查状态，坏的直接剔除，
    //      避免指导书默认第一张参考图就是「预览不可用」。
    const assetIds = Array.from(
      new Set(rawRows.map((r) => r.asset_id).filter((x): x is string => !!x)),
    );
    // 分块查状态避免 `.in()` 拼 URL 超长（现网 URI too long）
    const usableAssets = assetIds.length ? await this.fetchUsableAssetIds(assetIds) : new Set<string>();
    // asset_id 为空（极早期数据）或资产状态可预览的才保留
    const rows = rawRows.filter((r) => !r.asset_id || usableAssets.has(r.asset_id));

    // 3) 相关度打分（与图组同一套原则：模块只入围/排除，具体参数名词主导排序）：
    //    - 库行模块归一后与查询模块交集 +1；库行明确属于别的模块 -4（跨模块排除）。
    //    - 具体参数名词命中 key/name 每个 +2.5、命中 vision_note +1；弱功能词 key/name +0.5。
    //    - confidence 存 0..1 直接作基线；同 kb_version +0.05。
    //    再按「同模块内至少命中 1 个具体参数名词」过滤：评分项能抽出参数名词时，
    //    只靠泛词/同模块撞中的行剔除（压「同模块不同参数」误匹配）。
    const modSet = new Set(terms.modules);
    const fnSet = terms.functions;
    const paramSet = terms.params;
    const hasQueryParams = paramSet.length > 0;
    const score = (r: ParameterMappingRow): { score: number; paramHit: boolean } => {
      let s = Number(r.confidence); // 0..1 基线
      const pkey = (r.parameter_key ?? '').toLowerCase();
      const pname = (r.parameter_name ?? '').toLowerCase();
      const note = (r.vision_note ?? '').toLowerCase();
      if (opts.kbVersion && r.kb_version === opts.kbVersion) s += 0.05;

      const rowMods = new Set([
        ...extractModules(r.system_module),
        ...extractModules(pkey.split(':')[0]),
      ]);
      if (modSet.size > 0) {
        if (Array.from(modSet).some((m) => rowMods.has(m))) s += 1;
        else if (rowMods.size > 0) s -= 4;
      }

      let paramHit = false;
      for (const p of paramSet) {
        if (pkey.includes(p) || pname.includes(p)) {
          s += 2.5;
          paramHit = true;
        } else if (note.includes(p)) {
          s += 1;
          paramHit = true;
        }
      }
      for (const f of fnSet) {
        if (pkey.includes(f) || pname.includes(f)) s += 0.5;
        else if (note.includes(f)) s += 0.25;
      }
      return { score: s, paramHit };
    };

    const byAsset = new Map<string, { row: ParameterMappingRow; score: number }>();
    for (const r of rows) {
      const { score: s, paramHit } = score(r);
      // 评分项有具体参数名词时，要求命中行也命中 ≥1 个（或库行无法判定模块时放行兜底）
      if (hasQueryParams && !paramHit) continue;
      const assetKey = r.asset_id ?? r.example_id;
      const cur = byAsset.get(assetKey);
      if (!cur || s > cur.score) byAsset.set(assetKey, { row: r, score: s });
    }

    return Array.from(byAsset.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(({ row: r }) => ({
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
      }));
  }

  /**
   * 按参数召回「整组参考截图」。
   *
   * 真实交付里一条参数通常由同一文档同一 ▲ 小节下的连续多张截图响应（如「多形态」
   * 形态1…8）。学习时已按小节把这些图沉淀为 screenshot_parameter_groups，这里把评分项
   * 标题拆词后与小节标题做相关度打分，返回最匹配的一整组图（按文档 seq 顺序）。
   * 找不到合格图组时返回 null，由调用方回退到散图 searchByParameter。
   */
  /**
   * 按参数召回「整组参考截图」——单组（最佳）版，兼容既有调用。
   * 内部复用 searchReferenceGroups，返回 Top1。
   */
  async searchReferenceGroup(
    keywords: string[],
    opts: { limit?: number; kbVersion?: string; minScore?: number } = {},
  ): Promise<ReferenceGroup | null> {
    const groups = await this.searchReferenceGroups(keywords, {
      limit: opts.limit,
      kbVersion: opts.kbVersion,
      minScore: opts.minScore,
      candidateCount: 1,
    });
    return groups[0] ?? null;
  }

  /**
   * 按参数召回「整组参考截图」——多候选版（A 方案）。
   *
   * 真实交付里一条参数通常由同一文档同一 ▲ 小节下的连续多张截图响应；但自动打分
   * 不一定能把「专门参数组」排到最前（总览/门户类大杂烩组什么词都沾）。因此这里
   * 不只返回 Top1，而是返回按相关度排序的前 N 个合格候选组（默认 4 个），供前端
   * 展示候选列表、由用户一键勾选最贴合的一组，选择结果用于指导书导出。
   * 无合格图组时返回空数组，由调用方回退到散图 searchByParameter。
   */
  async searchReferenceGroups(
    keywords: string[],
    opts: {
      limit?: number;
      kbVersion?: string;
      minScore?: number;
      candidateCount?: number;
    } = {},
  ): Promise<ReferenceGroup[]> {
    // 召回池必须够大：全库图组随补齐增多（~470 组），宽 or 预过滤可能命中 200+ 组，
    // 小而准的专门参数组（往往只 2~4 张图）若被 limit 截断，会在打分前丢失、错误回退散图。
    // 打分在内存进行，400 组开销可控；order 见下——不按图数排序截断。
    const limit = opts.limit ?? 400;
    const candidateCount = opts.candidateCount ?? 4;
    const terms = extractMatchTerms(keywords);

    // 1) 召回候选图组（模块别名 / 具体参数名词 / 原始关键词 ilike 小节标题）。
    //    宁多勿滥：召回宽、打分阶段再用「同模块 + 具体参数名词」严格收敛。
    const ors: string[] = [];
    for (const mod of terms.modules) {
      for (const alias of MODULE_ALIASES[mod] ?? [mod]) {
        const a = alias.toLowerCase().replace(/\s/g, '');
        if (a.length >= 2) ors.push(`section_title.ilike.%${a}%`);
      }
    }
    for (const p of terms.params) ors.push(`section_title.ilike.%${p}%`);
    for (const w of terms.weak) ors.push(`section_title.ilike.%${w}%`);
    for (const fn of terms.functions) ors.push(`section_title.ilike.%${fn}%`);
    // 原文关键词兜底用 clipIlKeywords 截短——长 requirement（可达数百字）直接整句拼 .or()
    // 会让 PostgREST URI 超长（现网 `URI too long`），长文语义由 extractMatchTerms 承担。
    for (const kw of clipIlKeywords(keywords)) {
      const safe = kw.replace(/[,()（）、，:：%]/g, ' ').trim();
      if (safe.length >= 2) ors.push(`section_title.ilike.%${safe}%`);
    }
    if (ors.length === 0) return [];

    let q = this.db
      .from('screenshot_parameter_groups')
      .select(
        'id,record_id,section_title,image_count,kb_version,bidding_screenshots(project_name,project_school)',
      )
      .limit(limit);
    // 注意：召回候选不要按 image_count desc 排序再截断。专门参数组往往只有 2~4 张图，
    // 而全库图组数随补齐增多（500 上限内 ~160 组 → 全库 ~470 组），按图数倒序 limit 会让
    // 小而准的组在打分前被几十个大杂烩大组挤出（曾导致「一键转化」2 张专门组漏召回、回退散图）。
    // 这里只做关键词召回（or ilike）+ limit 兜底防超大结果集，排序完全交给打分阶段。
    q = q.or(ors.join(','));

    const { data, error } = await q;
    if (error) throw error;
    const groupRows = (data ?? []) as unknown as Array<GroupRow & {
      bidding_screenshots?: { project_name?: string; project_school?: string } | null;
    }>;
    if (groupRows.length === 0) return [];

    // 2) 打分 + 采用判定。打分用 scoreGroupTitle（模块只入围/排除，具体参数名词主导排序）；
    //    是否「采用」用 scoreGroupResult：同模块内必须命中 ≥1 个具体参数名词，
    //    否则只是同一模块下的别的参数（如「样式」需求命中「多形态编辑」组），不采、回退散图。
    const evaluate = (g: (typeof groupRows)[number]) => {
      const rawTitle = g.section_title ?? '';
      const compactTitle = rawTitle
        .toLowerCase()
        .replace(/[\s，,。.；;：:、（）()【】\[\]"'“”‘’！!？?/\\\-—_·]/g, '');
      const titleMods = new Set(extractModules(rawTitle));
      const modHit =
        terms.modules.length > 0 && terms.modules.some((m) => titleMods.has(m));
      const paramHit = terms.params.filter((p) => compactTitle.includes(p)).length;
      const hitParams = terms.params.filter((p) => compactTitle.includes(p));
      const fnHit = terms.functions.some((f) => compactTitle.includes(f.toLowerCase()));
      const phraseHit = keywords
        .filter(Boolean)
        .slice(0, 6)
        .some((kw) => {
          const safe = kw.replace(/[,()（）、，:：%\s▲▲]/g, '').toLowerCase();
          return safe.length >= 4 && compactTitle.includes(safe);
        });
      const score = scoreGroupTitle(rawTitle, terms, keywords, opts.kbVersion, g.kb_version);
      const adopt =
        opts.minScore != null
          ? score >= opts.minScore
          : scoreGroupResult(score, {
              modHit,
              paramHit,
              hasQueryParams: terms.params.length > 0,
              fnHit,
              phraseHit,
            }).adopt;
      return { g, score, adopt, hitParams };
    };

    const scored = groupRows
      .map(evaluate)
      .filter((x) => x.adopt)
      .sort((a, b) => b.score - a.score || b.g.image_count - a.g.image_count);
    if (scored.length === 0) return [];

    // 3) 取前 N 个候选组，批量加载组内图片（按 seq），并过滤坏资产。
    const tops = scored.slice(0, candidateCount);
    const topGroupIds = tops.map((x) => x.g.id);
    const { data: itemRows, error: itemErr } = await this.db
      .from('screenshot_group_assets')
      .select('group_id,asset_id,seq')
      .in('group_id', topGroupIds)
      .order('seq', { ascending: true });
    if (itemErr) throw itemErr;
    const items = (itemRows ?? []) as GroupAssetRow[];

    const assetIds = Array.from(new Set(items.map((i) => i.asset_id)));
    const usable = assetIds.length ? await this.fetchUsableAssetIds(assetIds) : new Set<string>();

    const results: ReferenceGroup[] = [];
    for (const x of tops) {
      const g = x.g;
      const orderedAssets = items
        .filter((i) => i.group_id === g.id && usable.has(i.asset_id))
        .map((i) => ({ assetId: i.asset_id, seq: i.seq, visionNote: null }));
      // 组内没有任何可预览图则跳过该候选（坏资产组不进候选列表）
      if (orderedAssets.length === 0) continue;
      const biz = g.bidding_screenshots ?? null;
      results.push({
        groupId: g.id,
        sectionTitle: g.section_title,
        imageCount: g.image_count,
        score: x.score,
        sourceRecordId: g.record_id,
        sourceProjectName: biz?.project_name ?? null,
        sourceSchool: biz?.project_school ?? null,
        assets: orderedAssets,
      });
    }
    return results;
  }

  /**
   * 知识库图片搜索（人工挑图工作台用）：按参数关键词/模块名在全库图组里检索，
   * 返回**单张大图平铺**结果，每张图带所属图组上下文（可一键整组加入）。
   *
   * 与 searchReferenceGroups 的区别：
   * - 这里面向「人主动搜、自己挑」，召回更宽（不做严格 adopt 门槛），按相关度排序后平铺；
   * - 结果以单张图为单位，group 字段标注来源图组；同组图片连续返回，便于整组加入。
   */
  async searchKbImages(
    keywords: string[],
    opts: { limit?: number } = {},
  ): Promise<KbImageHit[]> {
    const totalLimit = opts.limit ?? 60;
    const terms = extractMatchTerms(keywords);

    // 1) 宽召回图组：模块别名 / 参数名词 / 功能词 / 原始关键词 命中 section_title
    const ors: string[] = [];
    for (const mod of terms.modules) {
      for (const alias of MODULE_ALIASES[mod] ?? [mod]) {
        const a = alias.toLowerCase().replace(/\s/g, '');
        if (a.length >= 2) ors.push(`section_title.ilike.%${a}%`);
      }
    }
    for (const p of terms.params) ors.push(`section_title.ilike.%${p}%`);
    for (const w of terms.weak) ors.push(`section_title.ilike.%${w}%`);
    for (const fn of terms.functions) ors.push(`section_title.ilike.%${fn}%`);
    // 原文关键词兜底同样走 clipIlKeywords（避免长 requirement 整句进 OR 触发 URI too long）
    for (const kw of clipIlKeywords(keywords)) {
      const safe = kw.replace(/[,()（）、，:：%]/g, ' ').trim();
      if (safe.length >= 2) ors.push(`section_title.ilike.%${safe}%`);
    }
    if (ors.length === 0) return [];

    const { data: groupData, error: gErr } = await this.db
      .from('screenshot_parameter_groups')
      .select('id,record_id,section_title,image_count,kb_version,bidding_screenshots(project_name,project_school)')
      .or(ors.join(','))
      .limit(200);
    if (gErr) throw gErr;
    const groupRows = (groupData ?? []) as unknown as Array<GroupRow & {
      bidding_screenshots?: { project_name?: string; project_school?: string } | null;
    }>;
    if (groupRows.length === 0) return [];

    // 2) 用 scoreGroupTitle 打分（不做严格 adopt，人来判断），取相关度最高的前 N 组
    const scored = groupRows
      .map((g) => ({ g, score: scoreGroupTitle(g.section_title ?? '', terms, keywords, undefined, g.kb_version) }))
      .sort((a, b) => b.score - a.score || b.g.image_count - a.g.image_count)
      .slice(0, 24);

    // 3) 加载这些组的全部资产（按 seq），过滤可预览资产
    const topIds = scored.map((x) => x.g.id);
    const { data: itemRows, error: itemErr } = await this.db
      .from('screenshot_group_assets')
      .select('group_id,asset_id,seq')
      .in('group_id', topIds)
      .order('seq', { ascending: true });
    if (itemErr) throw itemErr;
    const items = (itemRows ?? []) as GroupAssetRow[];

    const assetIds = Array.from(new Set(items.map((i) => i.asset_id)));
    const usable = assetIds.length ? await this.fetchUsableAssetIds(assetIds) : new Set<string>();

    // 4) 平铺成单张结果：组按相关度、组内按 seq；同 asset 跨组只保留得分最高的一次
    const hits: KbImageHit[] = [];
    const seenAsset = new Set<string>();
    for (const { g, score } of scored) {
      const biz = g.bidding_screenshots ?? null;
      const groupAssets = items
        .filter((i) => i.group_id === g.id && usable.has(i.asset_id))
        .sort((a, b) => a.seq - b.seq);
      groupAssets.forEach((ga, idx) => {
        if (seenAsset.has(ga.asset_id)) return;
        seenAsset.add(ga.asset_id);
        hits.push({
          assetId: ga.asset_id,
          score,
          seqInGroup: ga.seq,
          group: {
            groupId: g.id,
            sectionTitle: g.section_title,
            imageCount: g.image_count,
            sourceRecordId: g.record_id,
            sourceProjectName: biz?.project_name ?? null,
            sourceSchool: biz?.project_school ?? null,
          },
        });
      });
      if (hits.length >= totalLimit) break;
    }
    return hits.slice(0, totalLimit);
  }
}

/** 知识库图片搜索的单张结果（带所属图组上下文） */
export interface KbImageHit {
  assetId: string;
  /** 所属图组的相关度得分（同组图片一致） */
  score: number;
  /** 在所属图组中的序号 */
  seqInGroup: number;
  group: {
    groupId: string;
    sectionTitle: string;
    imageCount: number;
    sourceRecordId: string;
    sourceProjectName: string | null;
    sourceSchool: string | null;
  };
}

/**
 * 系统模块受控词表：key=标准模块名，value=历史数据里出现过的别名/自由写法。
 * 视觉标签/图组标题里同一模块写法极发散（AI助教/ai助教/AI助教-作业批改），
 * 不归一会导致模块词抽不全、也和库内标签对不上。匹配时统一归算到标准名。
 */
const MODULE_ALIASES: Record<string, string[]> = {
  知识图谱: ['知识图谱', '知识森林', '课程图谱', '图谱'],
  问题图谱: ['问题图谱', '题库图谱'],
  ai助教: ['ai助教', 'ai 助教', '人工智能助教', '智能助教', '大模型回复', 'ai对话', '助教'],
  作业: ['作业批改', '作业管理', '作业'],
  智能问答: ['智能问答', '业务问答', 'ai问答', 'ai答疑', '智能答疑', '智能客服', '问答库', '客服', '问答', '答疑'],
  ai教案: ['ai教案', '智能教案', '教案'],
  微课: ['微课', '微课制作'],
  ppt创作: ['ppt创作', 'ppt课件', 'ppt制作', 'ppt', '课件制作', '课件'],
  备课: ['备课', '智能备课', '备授课', '团队备课'],
  课堂互动: ['课堂互动', '互动课堂', '投屏', '签到', '抢答', '课堂'],
  学情分析: ['ai学情分析', '学情分析', '学情', '数据分析', '数据统计', '数据看板', '统计分析', '掌握率', '完成率'],
  实践教学: ['ai实践', '实践教学', '实践报告', '实训', '虚拟仿真', '实践'],
  文献检测: ['文献检测', '论文检测', '查重', '论文管理', '论文'],
  达成度: ['课程达成度', '达成度', '专业评价', '毕业要求达成', '毕业要求', '课程目标达成', '达标标准'],
  资源管理: ['资源管理', '资源中心', '资源库', '资源'],
  门户: ['门户', '首页', '工作台', '个人空间'],
  自测: ['自测', '随堂练习', '在线考试', '在线考核', '监考', '防作弊', '活体检测', '活体人脸', '人脸核对', '人脸识别', '练习', '测验', '考试'],
  题库组卷: ['题库管理', '题库安全', '题库建设', '智能组卷', '组卷逻辑', '组卷', '题库', '题目来源'],
  资产库存: ['资产库存', '库存盘点', '资产盘点', '资产清理', '资产报废', '资产入库', '资产管理', '库存'],
  培养方案: ['培养方案对比', '方案对比', '版本对比', '培养方案', '人才培养方案', '培养目标', '毕业要求设置'],
  教学督导: ['教学督导', '督导听课', '督导评价', '巡课', '听课任务', '远程听课', '直播听课', '智慧教室', '直播录播', '录播平台', '随堂评价', '即时评价', '评价窗口', '直播', '录播', '评教', '教学评价', '同行评价', '领导评价', '教学质量', '督导'],
  系统管理: ['系统字典', '数据字典', '基础数据管理', '基础数据', '用户管理', '权限管理', '组织架构', '系统管理'],
  报告: ['学习报告', '统计报表', '报告'],
  移动端: ['移动端', '手机端', 'app', '小程序'],
};

/** 从一段文本里找出出现的标准模块（命中任一别名即归算到标准名），去重返回。 */
export function extractModules(text: string | null | undefined): string[] {
  if (!text) return [];
  const t = text.toLowerCase().replace(/[\s，,。.；;：:、（）()【】\[\]"'“”‘’！!？?/\\\-—_·]/g, '');
  const found = new Set<string>();
  for (const [canonical, aliases] of Object.entries(MODULE_ALIASES)) {
    const hit = aliases.some((a) => t.includes(a.toLowerCase().replace(/\s/g, '')));
    if (hit) found.add(canonical);
  }
  return Array.from(found);
}

/**
 * 泛动词/套话/操作步骤停用词。
 * 「自定义/设置/编辑/管理/配置/支持/选择/切换」这类词几乎每条参数标题里都有
 * （自定义颜色、自定义背景、自定义编辑、自定义样式……），用它们匹配会把同一模块下
 * 所有参数拉平，必须停用，不能当功能词参与打分。
 */
const FUNC_STOP = new Set([
  '登录', '点击', '打开', '进入', '选择', '找到', '按照', '如图', '所示', '按钮', '菜单',
  '后台', '账号', '密码', '截图', '如下', '下图', '上图', '填写', '输入', '提交', '保存',
  '返回', '查看', '看到', '显示', '对应', '需要', '可以', '进行', '相关', '功能', '模块',
  '内容', '信息', '方式', '地方', '位置', '步骤', '操作', '页面', '系统', '平台', '完成',
  '支持', '提供', '具备', '拥有', '实现', '可', '能够', '自定义', '设置', '编辑', '管理',
  '配置', '切换', '展示', '用户', '教师', '学生', '个人', '自主', '手动', '自动',
  '多种', '多个', '多类型', '多方式', '各种', '不少于', '至少', '根据', '需求', '喜好',
]);

/**
 * 具体参数名词表（高区分度）——真正区分「同模块下不同参数」的词。
 * 如知识图谱模块下：样式/颜色/形态/节点/大纲 是不同参数；这些词命中才代表参数对得上。
 * 模块名只负责「入围/跨模块排除」，排序主要靠这些具体名词重叠。
 */
const PARAM_NOUNS = [
  '样式', '颜色', '背景色', '背景', '字体', '字号', '文字颜色', '文字大小', '皮肤', '边框',
  '图谱形态', '形态', '节点', '大纲', '标签', '画像', '标注', '导航', '学习地图',
  '一键转化', '转化', '资源关联', '关联资源', '跨课程', '图谱模式', '大纲模式',
  '作业批改', '批改', '答疑', '问答库', '客服', '回复', '答案', '解析', '反馈', '评价',
  '评分', '文档解析', '网络课程',
  '达成度', '课程目标', '毕业要求', '培养方案', '方案对比', '版本对比', '达标',
  '微课', '课件', '导入', '导出', '上传', '下载', '名单',
  '组卷', '题库', '题目', '乱序', '选项', '听力', '音频', '监考', '人脸', '活体', '防作弊',
  '自测模式', '探索模式', '时间限制', '题目来源',
  '水位', '掌握率', '完成率', '雷达', '看板', '预警', '监控', '考勤', '签到', '抢答', '投屏',
  '听课', '督导', '巡课', '评教', '直播', '录播', '对接',
  '库存', '盘点', '资产', '报废', '入库', '字典', '权限', '组织架构', '同步', '推送', '移动端',
  // 视觉属性/配置项（高区分度，专门防止「大杂烩总览组」靠堆砌词虚高）
  '标红', '高亮', '绘制', '排版', '浅色',
];

/**
 * 弱领域词：在该业务域内几乎每条参数都会出现（知识图谱域的「知识点/章节」、
 * 通用的「资源/内容/数据」），跨参数零区分度。参与召回 ilike 与弱打分(+0.5)，
 * 但**不计入强参数名词命中**（不决定采用门槛、不主导排序）。
 */
const WEAK_DOMAIN = ['知识点', '章节', '资源', '内容', '数据', '课程'];

/**
 * 从评分项标题/关键词里抽取「标准模块词 + 功能词」。
 * - modules：归并到 MODULE_ALIASES 标准名的业务模块（AI助教/ai助教/AI助教-作业批改 → ai助教）。
 * - functions：去掉模块名/套话/操作步骤噪声后，按功能动词边界切出的名词短语（≥3 字、含实义）。
 */
export function extractMatchTerms(keywords: string[]): {
  modules: string[];
  params: string[];
  weak: string[];
  functions: string[];
} {
  const modules = new Set<string>();
  const paramSet = new Set<string>();
  const weakSet = new Set<string>();
  const functionSet = new Set<string>();

  for (const raw of keywords) {
    if (!raw) continue;
    // 归一化：去标点、空白、常见套话前缀，转小写
    let text = raw
      .replace(/[\s，,。.；;：:、（）()【】\[\]"'“”‘’！!？?/\\\-—_·]/g, '')
      .toLowerCase();
    text = text.replace(/^(支持|提供|具备|可|能够|可以|实现|拥有|含|包括|系统|平台)+/g, '');
    text = text.replace(/(功能|情况|能力)$/g, '');

    // ① 具体参数名词：直接在归一化全文扫描（高区分度，主导信号）
    for (const noun of PARAM_NOUNS) {
      if (text.includes(noun.toLowerCase())) paramSet.add(noun.toLowerCase());
    }

    // ①b 弱领域词：仅用于召回 ilike 兜底，不主导排序/采用门槛
    for (const w of WEAK_DOMAIN) {
      if (text.includes(w.toLowerCase())) weakSet.add(w.toLowerCase());
    }

    for (const [canonical, aliases] of Object.entries(MODULE_ALIASES)) {
      const compactAliases = aliases.map((a) => a.toLowerCase().replace(/\s/g, ''));
      if (compactAliases.some((a) => text.includes(a))) {
        modules.add(canonical);
        for (const a of compactAliases) text = text.split(a).join(' ');
      }
    }

    // ③ 剩余短语按功能动作边界切分，去停用词/模块/参数名词后作弱兜底
    const parts = text
      .split(/\s+|(?=(?:一键|智能|关联|导入|导出|生成|检索|搜索|统计|反馈|解析|标签|画像|转化|可视化|导航|标注|属性|模型|回复|答案|名单|分布|形态|章节|节点|批改|组卷|排课|巡课|考核|监控|预警|推送|同步|对接|盘点|库存|人脸|监考|直播|录播))/g)
      .map((p) => p.trim())
      .filter((p) => p.length >= 3 && p.length <= 12);
    for (const p of parts) {
      // 过滤含模块词、停用词、参数名词、纯数字的碎片
      if (extractModules(p).length > 0) continue;
      if (Array.from(FUNC_STOP).some((n) => p.includes(n))) continue;
      if (Array.from(paramSet).some((n) => p.includes(n) || n.includes(p))) continue;
      if (/^\d+$/.test(p)) continue;
      functionSet.add(p);
    }
  }

  return {
    modules: Array.from(modules),
    params: Array.from(paramSet).slice(0, 12),
    weak: Array.from(weakSet).slice(0, 8),
    functions: Array.from(functionSet).slice(0, 8),
  };
}

/**
 * 图组标题相关度打分（纯函数，服务端召回与评测脚本共用）。
 * 匹配主轴是「具体参数名词」而非模块名：模块只负责同模块入围(+1)/跨模块排除(-4)；
 * 具体参数名词命中 +2.5（决定排序）；弱功能词 +0.5；整句长串重合 +1；版本一致 +0.05。
 * 采用门槛见 scoreGroupResult：同模块需至少命中 1 个具体参数名词，跨模块直接不采。
 */
/**
 * 把原始搜索关键词截成「适合拼进 OR 的长字段 ilike」的短词列表。
 * 背景：generate() 会把评分项 requirement（可达数百字）当作原始关键词传入，若整句塞进
 * PostgREST 的 .or() 会导致 URI 超长（现网 `URI too long` 报错）。因此按标点/空白/功能
 * 动作边界切块，仅保留 <= 24 字的短块；超过该长度的长文语义由 extractMatchTerms 的词袋承担，
 * 这里只兜底短句命中，保证召回不丢且 URL 不炸。
 */
export function clipIlKeywords(keywords: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of keywords) {
    const normalized = String(raw ?? '').replace(/[,()（）、，:：|"']/g, ' ').trim();
    if (!normalized) continue;
    if (normalized.length <= 24) {
      const k = normalized.toLowerCase();
      if (!seen.has(k)) {
        seen.add(k);
        out.push(normalized);
      }
      continue;
    }
    // 长文本按功能动作边界 + 标点切块，取每块前 24 字以内的片段
    const blocks = normalized
      .split(/\s+|(?=(?:一键|智能|关联|导入|导出|生成|检索|搜索|统计|反馈|解析|标签|画像|转化|可视化|导航|标注|属性|模型|回复|答案|名单|分布|形态|章节|节点|批改|组卷|排课|巡课|考核|监控|预警|推送|同步|对接|盘点|库存|人脸|监考|直播|录播))/g)
      .map((b) => b.trim())
      .filter((b) => b.length >= 2);
    for (const b of blocks) {
      const piece = b.length <= 24 ? b : b.slice(0, 24);
      const bkey = piece.toLowerCase();
      if (!seen.has(bkey)) {
        seen.add(bkey);
        out.push(piece);
      }
      if (out.length >= 8) return out;
    }
  }
  return out.slice(0, 8);
}

export function scoreGroupTitle(
  rawTitle: string,
  terms: { modules: string[]; params: string[]; weak?: string[]; functions: string[] },
  keywords: string[],
  kbVersion?: string,
  groupVersion?: string | null,
): number {
  const title = rawTitle
    .toLowerCase()
    .replace(/[\s，,。.；;：:、（）()【】\[\]"'“”‘’！!？?/\\\-—_·]/g, '');
  let s = 0;
  if (kbVersion && groupVersion === kbVersion) s += 0.05;

  // 模块：同模块 +1（入围），标题明确属于别的模块 -4（跨模块重名排除）
  const titleMods = new Set(extractModules(rawTitle));
  let modHit = false;
  if (terms.modules.length > 0) {
    if (terms.modules.some((m) => titleMods.has(m))) {
      modHit = true;
      s += 1;
    } else if (titleMods.size > 0) {
      s -= 4;
    }
  }

  // 具体参数名词：主导排序信号
  let paramHit = 0;
  for (const p of terms.params) {
    if (title.includes(p.toLowerCase())) {
      s += 2.5;
      paramHit += 1;
    }
  }
  // 弱功能短语：仅兜底，低权
  let fnHit = false;
  for (const f of terms.functions) {
    if (title.includes(f.toLowerCase())) {
      s += 0.5;
      fnHit = true;
    }
  }
  // 弱领域词（知识点/章节/资源…）：整串命中才给一次极小加分，仅用于毫无强信号时的排序，
  // 不进采用门槛、不叠加，避免总览组靠堆砌泛词虚高。
  if ((terms.weak ?? []).some((w) => title.includes(w.toLowerCase()))) s += 0.2;
  // 整句长串重合（≥4 字，标题原文照抄评分项时）
  let phraseHit = false;
  for (const kw of keywords.filter(Boolean).slice(0, 6)) {
    const safe = kw.replace(/[,()（）、，:：%\s▲▲]/g, '').toLowerCase();
    if (safe.length >= 4 && title.includes(safe)) {
      s += 1;
      phraseHit = true;
    }
  }

  // 主题集中度惩罚：一个标题里堆砌 ≥4 个功能分句（门户/总览/大杂烩组），
  // 而命中的强参数名词只集中在其中少数分句时，说明这组图只是「顺带提到」该参数，
  // 不是专门参数页——这类组什么词都沾、分数虚高，必须压过专注组。
  if (paramHit > 0) {
    const clauses = rawTitle
      .split(/[；;。]/)
      .map((c) => c.toLowerCase().replace(/[\s，,。.；;：:、（）()【】\[\]"'“”‘’！!？?/\\\-—_·]/g, ''))
      .filter((c) => c.length >= 4);
    if (clauses.length >= 4) {
      const hitClauses = new Set<number>();
      for (const p of terms.params) {
        if (!title.includes(p.toLowerCase())) continue;
        clauses.forEach((c, ci) => {
          if (c.includes(p.toLowerCase())) hitClauses.add(ci);
        });
      }
      // 命中分散度：命中的分句数 / 总分句数。专注组≈高（整篇讲一个参数），总览组≈很低。
      if (hitClauses.size / clauses.length < 0.34) s -= 2;
    }
  }
  return s;
}

/**
 * 判断某图组得分是否达到「采用」门槛（排序分高不代表可用）：
 * - 跨模块（分数被压到负）直接不采；
 * - 同模块内必须至少命中 1 个具体参数名词（paramHit）——否则只是同模块下别的参数；
 * - 若评分项本身抽不出具体参数名词（纯模块级需求），则同模块 + 整句/功能词命中即可。
 * 返回 { adopt, paramHit }。
 */
export function scoreGroupResult(
  score: number,
  opts: {
    modHit: boolean;
    paramHit: number;
    hasQueryParams: boolean;
    fnHit: boolean;
    phraseHit: boolean;
  },
): { adopt: boolean; paramHit: number } {
  if (score < 0) return { adopt: false, paramHit: opts.paramHit };
  if (opts.hasQueryParams) {
    return { adopt: opts.paramHit >= 1, paramHit: opts.paramHit };
  }
  return { adopt: opts.modHit && (opts.fnHit || opts.phraseHit), paramHit: opts.paramHit };
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
