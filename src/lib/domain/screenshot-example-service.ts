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

    // 2) 组装 OR 召回条件：模块词命中 system_module/parameter_key 前缀，
    //    功能词命中 parameter_key/parameter_name；vision_note 权重最低，用最短的词兜底。
    const ors: string[] = [];
    for (const mod of terms.modules) {
      ors.push(`system_module.ilike.%${mod}%`);
      ors.push(`parameter_key.ilike.${mod}:%`);
    }
    for (const fn of terms.functions) {
      ors.push(`parameter_key.ilike.%${fn}%`);
      ors.push(`parameter_name.ilike.%${fn}%`);
    }
    // 原始关键词（去掉标点）在 parameter_name 上兜底
    for (const kw of keywords.filter(Boolean).slice(0, 6)) {
      const safe = kw.replace(/[,()（）、，:：]/g, ' ').trim();
      if (safe.length >= 2 && !terms.functions.includes(safe.toLowerCase())) {
        ors.push(`parameter_name.ilike.%${safe}%`);
      }
    }
    if (ors.length) q = q.or(ors.join(','));

    const { data, error } = await q;
    if (error) throw error;
    const rawRows = (data ?? []) as unknown as ParameterMappingRow[];

    // 2.5) 过滤掉预览不可用的坏资产（stored/direct 之外，如原始文件缺失的 failed）。
    //      mapping.asset_id 指向 external_file_assets；批量查状态，坏的直接剔除，
    //      避免指导书默认第一张参考图就是「预览不可用」。
    const assetIds = Array.from(
      new Set(rawRows.map((r) => r.asset_id).filter((x): x is string => !!x)),
    );
    const usableAssets = new Set<string>();
    if (assetIds.length) {
      const { data: assets, error: assetErr } = await this.db
        .from('external_file_assets')
        .select('id,status')
        .in('id', assetIds);
      if (assetErr) throw assetErr;
      for (const a of assets as Array<{ id: string; status: string }>) {
        if (a.status === 'stored' || a.status === 'direct') usableAssets.add(a.id);
      }
    }
    // asset_id 为空（极早期数据）或资产状态可预览的才保留
    const rows = rawRows.filter((r) => !r.asset_id || usableAssets.has(r.asset_id));

    // 3) 相关度打分：模块命中 +2，功能词命中 parameter_key/name 每个 +2，
    //    命中 vision_note +0.5；同 asset 保留得分最高者，最后按 (得分, confidence) 排序。
    const modSet = terms.modules;
    const fnSet = terms.functions;
    const score = (r: ParameterMappingRow): number => {
      let s = Number(r.confidence) / 100; // 0..1 基线
      const pkey = (r.parameter_key ?? '').toLowerCase();
      const pname = (r.parameter_name ?? '').toLowerCase();
      const mod = (r.system_module ?? '').toLowerCase();
      const note = (r.vision_note ?? '').toLowerCase();
      if (opts.kbVersion && r.kb_version === opts.kbVersion) s += 0.05;
      for (const m of modSet) {
        if (mod.includes(m) || pkey.startsWith(`${m}:`)) s += 2;
      }
      for (const f of fnSet) {
        if (pkey.includes(f) || pname.includes(f)) s += 2;
        else if (note.includes(f)) s += 0.5;
      }
      return s;
    };

    const byAsset = new Map<string, { row: ParameterMappingRow; score: number }>();
    for (const r of rows) {
      const assetKey = r.asset_id ?? r.example_id;
      const s = score(r);
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
}

/**
 * 从评分项标题/关键词里抽取「系统模块词」和「功能词」。
 * - modules：知识图谱/问题图谱/微课/AI教案/学情分析/实践/文献检测/达成度 等业务模块名。
 * - functions：去掉模块名和「支持/提供/具备/功能」等套话后，按功能语义拆出的短语。
 */
const MODULE_HINTS = [
  '知识图谱', '知识森林', '问题图谱', '课程图谱', '微课', 'ai教案', '教案',
  'ai学情分析', '学情分析', 'ai实践', '实践', '文献检测', '课程达成度', '达成度',
  '数据统计', '资源管理', '业务问答', '问答', '助教', '移动端', '自测', '报告',
];

function extractMatchTerms(keywords: string[]): { modules: string[]; functions: string[] } {
  const modules = new Set<string>();
  const functionSet = new Set<string>();

  for (const raw of keywords) {
    if (!raw) continue;
    // 归一化：去标点、空白、常见套话前缀，转小写
    let text = raw
      .replace(/[\s，,。.；;：:、（）()【】\[\]"'""''！!？?\/\\\-—_·]/g, '')
      .toLowerCase();
    text = text.replace(/^(支持|提供|具备|可|能够|可以|实现|拥有|含|包括|系统|平台)+/g, '');
    text = text.replace(/(功能|情况|能力)$/g, '');

    for (const m of MODULE_HINTS) {
      if (text.includes(m)) {
        modules.add(m);
        text = text.split(m).join(' ');
      }
    }

    // 剩余按功能动作拆词：在「一键/自定义/智能/多/双/关联/导入/导出/生成/切换/编辑/检索/统计/展示/查看/反馈/解析/上传/下载/关联/标签/画像」等动词边界切分
    const parts = text
      .split(/\s+|(?=(?:一键|自定义|智能|多类型|多方式|多途径|多种|多个|双模式|双|关联|导入|导出|生成|切换|编辑|检索|搜索|统计|展示|显示|查看|反馈|解析|上传|下载|标签|画像|报告|转化|可视化|导航|标注|属性|背景色|样式|大纲|模型|回复|答案|文档|资料|资源|名单|模式|入口|内容|列表|详情|分布))/g)
      .map((p) => p.trim())
      .filter((p) => p.length >= 2 && p.length <= 12);
    for (const p of parts) {
      // 过滤纯模块名/纯套话
      if (MODULE_HINTS.includes(p)) continue;
      functionSet.add(p);
    }
  }

  return {
    modules: Array.from(modules),
    functions: Array.from(functionSet).slice(0, 10),
  };
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
