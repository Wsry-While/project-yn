import { getAdminSupabase } from './api-utils';
import { LLMClient, Config } from 'coze-coding-dev-sdk';
import { getModelForScenario } from './llm-prompts';
import {
  ScreenshotExampleService,
  type ParameterMapping,
  type ReferenceGroup,
} from './screenshot-example-service';
import { ScreenshotKnowledgeService } from './screenshot-knowledge-service';

/** 指导书里的一张参考截图（已归一，图组/散图共用） */
export interface GuideReference {
  assetId: string;
  storagePath: string | null;
  exampleId: string;
  visionNote: string | null;
  evidenceElements: string[] | null;
  confidence: number | null;
  sourceRecordId: string | null;
  sourceProjectName: string | null;
}

/**
 * 统一参考来源候选。一条参数可匹配到多个「参考来源」，前端用同一个选择器让用户
 * 勾选最贴合的一个，切换后 references 用该来源替换。
 * - kind='group'：整组截图（同一交付文档同一 ▲ 小节下的连续多张截图，最贴合真实交付）；
 * - kind='loose'：散图参考（跨参数的历史示例 Top N，兜底）。
 */
export interface ReferenceSource {
  /** 唯一标识：`group:<groupId>` 或 `loose:loose` */
  id: string;
  kind: 'group' | 'loose';
  /** 来源标题：图组为参数小节原句，散图为兜底文案 */
  title: string;
  imageCount: number;
  sourceProjectName: string | null;
  /** 该来源包含的参考截图（切换来源时直接使用） */
  refs: GuideReference[];
}

/** 截图指导书中的一个截图项 */
export interface GuideItem {
  itemId: string;
  /** 序号（与评分项 sort_order 对齐，从 1 开始） */
  seq: number;
  /** 评分项标题/参数名 */
  title: string;
  /** 系统模块（用于参考图召回） */
  systemModule?: string | null;
  /** 招标文件中的要求原文摘要 */
  requirement: string;
  /** 分值 */
  score?: number | null;
  /** 该项是否必须截图（一般参数可跳过） */
  mustCapture: boolean;
  /**
   * 当前生效的参考截图（= selectedAssetIds 按序反查候选池归一）。
   * 支持跨图组多选：用户可在任意「参考来源」里勾选/取消单张，顺序即用户排列顺序，
   * 导出 Word 与界面预览都以此为准。
   */
  references: GuideReference[];
  /**
   * 用户勾选的参考图 assetId 有序列表（跨组多选 + 排序）。
   * 默认取自动匹配的首个来源（整组默认全选、散图取 Top N），无需人工逐张点选。
   */
  selectedAssetIds: string[];
  /** 参考图来源的参数小节标题（选中图主要来自某个整组时用于展示，否则 null） */
  referenceGroupTitle?: string | null;
  /**
   * 统一参考来源候选池：自动召回不一定把「专门参数组」排最前，这里下发全部可选来源
   * （合格图组 + 散图兜底）。图片按组展示，但允许跨组勾选多张。
   */
  referenceSources?: ReferenceSource[];
  /** LLM 生成的作业说明：到哪个模块/菜单、截什么、怎么证明满足要求 */
  instruction: string;
  /** 建议的截图文件名/编号 */
  suggestedFileName: string;
  /** 该项状态（前端用户可编辑）：pending(待补充) / ready(可截图) / na(本项目无此项) */
  status: 'pending' | 'ready' | 'na';
}

/** 单项人工决策（跨组勾选 + 状态 + 手工说明），持久化到 screenshot_guides.item_selections */
export interface GuideItemSelection {
  status?: GuideItem['status'];
  /** 有序、可跨组；空数组表示该项不选任何参考图 */
  selectedAssetIds?: string[];
  /** 用户手工编辑过的作业说明（未编辑则不下发，沿用 AI 生成） */
  instructionOverride?: string;
}

/** 以 itemId 为键的人工决策合集 */
export type GuideSelections = Record<string, GuideItemSelection>;

export interface ScreenshotGuide {
  recordId: string;
  projectName: string;
  schoolName?: string | null;
  generatedAt: string;
  kbVersion: string | null;
  items: GuideItem[];
  totalScreenshots: number;
  matchedCount: number;
  unmatchedCount: number;
}

interface ScoreItemRow {
  id: string;
  item_no: number;
  title: string;
  item_type: string | null;
  delivery_method: string | null;
  score_value: number | null;
  requirement: string | null;
  order_index: number;
  category: string | null;
}

/**
 * 截图作业指导书生成服务。
 *
 * 流程：读取已确认文档的评分项 → 过滤需截图项 → 对每项按标题拆词
 * 召回知识库参考图（跨版本）→ 把参数要求+参考图证据喂给 LLM，生成「到哪个菜单/
 * 截什么/如何证明」的可执行作业说明。
 */
export const ScreenshotGuideService = {
  /**
   * 生成指导书（非流式：一次性返回完整结构）。
   * 进度通过 onProgress 回调推送，供 SSE 使用。
   */
  async generate(
    recordId: string,
    onProgress?: (step: string, detail?: string, percent?: number) => void,
    opts: { prevSelections?: GuideSelections } = {},
  ): Promise<ScreenshotGuide> {
    const supabase = getAdminSupabase();
    const exampleService = new ScreenshotExampleService(supabase);

    onProgress?.('load', '读取评分项与项目信息');

    // 1. 读记录与最新已确认文档（确认已生成过交付文档）
    const { data: record, error: recErr } = await supabase
      .from('bidding_screenshots')
      .select('id, project_name, project_school')
      .eq('id', recordId)
      .maybeSingle();
    if (recErr) throw new Error(`读取招投标记录失败: ${recErr.message}`);
    if (!record) throw new Error('招投标记录不存在');

    const { data: doc, error: docErr } = await supabase
      .from('bidding_documents')
      .select('id, version')
      .eq('record_id', recordId)
      .eq('status', 'ready')
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (docErr) throw new Error(`读取交付文档失败: ${docErr.message}`);
    if (!doc) throw new Error('请先生成并确认交付文档，再制作截图指导书');

    // 知识库最新版本（仅用于展示，不强制过滤）
    const kbVersion = await new ScreenshotKnowledgeService(supabase).getLatestVersion();

    // 2. 读评分项，只要截图类（delivery_method=screenshot），排除 na
    const { data: rows, error: itemErr } = await supabase
      .from('bidding_score_items')
      .select('id, item_no, title, item_type, delivery_method, score_value, requirement, order_index, category')
      .eq('record_id', recordId)
      .eq('delivery_method', 'screenshot')
      .neq('match_status', 'na')
      .order('order_index', { ascending: true });
    if (itemErr) throw new Error(`读取评分项失败: ${itemErr.message}`);

    const screenshotRows = (rows as ScoreItemRow[] | null) ?? [];
    if (screenshotRows.length === 0) {
      throw new Error('当前文档没有需要截图的评分项');
    }

    onProgress?.('match', `正在为 ${screenshotRows.length} 个参数匹配知识库参考图`, 10);

    // 3. 对每项召回参考图。
    //    优先召回「整组截图」——真实交付里一条参数常由同一文档同一小节下的连续多张
    //    截图响应（如「多形态」形态1…8）；找不到合格图组时回退到散图 Top3。
    const items: GuideItem[] = [];
    for (let i = 0; i < screenshotRows.length; i++) {
      const row = screenshotRows[i];
      const systemModule = row.category || null;
      // 召回只传评分项标题（+ 必要时原始标题），由召回服务内部拆模块/功能词；
      // 不要把 category（如"技术参数"）当系统模块拼进 parameter_key——视觉库的 key 前缀
      // 是真实业务模块（知识图谱/微课…），用 category 当前缀会导致精确与 ilike 全部落空。
      // 召回输入：标题 + 评分项详细描述（▲ 正文）。标题常只有「自定义样式设置」这类短句，
      // 区分参数的具体名词（颜色/字体/大小/形态…）往往在 requirement 正文里，必须一起参与抽词。
      const recallKeywords = [
        row.title,
        row.requirement ? String(row.requirement).slice(0, 220) : '',
      ].filter(Boolean) as string[];
      let groupTitle: string | null = null;
      let refs: GuideItem['references'] = [];

      // 统一来源召回（通用模式）：
      //   ① 整组截图：同一交付文档同一 ▲ 小节下的连续多张截图，最贴合真实交付；
      //   ② 散图兜底：跨参数历史示例 Top N（无合格图组、或用户想挑单张时）。
      // 两者都进 referenceSources 候选池，默认选中最匹配的（有图组取 Top1，否则散图），
      // 前端用统一选择器呈现，不区分图组/散图、不依赖命中数量。
      const [groups, loose] = await Promise.all([
        exampleService.searchReferenceGroups(recallKeywords, {
          kbVersion: kbVersion?.version,
          candidateCount: 4,
        }),
        exampleService.searchByParameter(recallKeywords, {
          limit: 4,
          kbVersion: kbVersion?.version,
        }),
      ]);

      const sources: ReferenceSource[] = [];
      for (const g of groups) {
        if (!g.assets.length) continue;
        sources.push({
          id: `group:${g.groupId}`,
          kind: 'group',
          title: g.sectionTitle,
          imageCount: g.assets.length,
          sourceProjectName: g.sourceProjectName,
          refs: mapGroupReferences(g),
        });
      }
      if (loose.length > 0) {
        const looseRefs = loose.map((r) => mapReference(r));
        sources.push({
          id: 'loose:loose',
          kind: 'loose',
          title: '历史散图参考（跨参数 Top 匹配）',
          imageCount: looseRefs.length,
          sourceProjectName: null,
          refs: looseRefs,
        });
      }

      const defaultSource = sources[0];
      if (defaultSource) {
        refs = defaultSource.refs;
        if (defaultSource.kind === 'group') groupTitle = defaultSource.title;
      }
      // 默认勾选首个来源的全部图（整组全选、散图取其 Top N），无需人工逐张点选
      const defaultAssetIds = refs.map((r) => r.assetId);

      items.push({
        itemId: row.id,
        seq: row.item_no || row.order_index + 1 || i + 1,
        title: row.title,
        systemModule,
        requirement: row.requirement || row.title,
        score: row.score_value != null ? Number(row.score_value) : null,
        mustCapture: row.item_type !== 'general',
        references: refs,
        selectedAssetIds: defaultAssetIds,
        referenceGroupTitle: groupTitle,
        referenceSources: sources.length > 0 ? sources : undefined,
        instruction: '',
        suggestedFileName: buildFileName(row, i + 1),
        status: 'pending',
      });
      onProgress?.(
        'match',
        `已匹配 ${i + 1}/${screenshotRows.length}`,
        10 + Math.round((i / screenshotRows.length) * 40),
      );
    }

    onProgress?.('generate', '正在由 AI 汇总作业说明', 55);

    // 4. LLM 批量生成说明（分批，每批 ≤ 15 项，避免 prompt 过长）
    const BATCH = 15;
    for (let start = 0; start < items.length; start += BATCH) {
      const batch = items.slice(start, start + BATCH);
      const instructions = await generateInstructionsWithLlm(batch);
      for (const [idx, text] of instructions.entries()) {
        const item = batch[idx];
        item.instruction = text || buildFallbackInstruction(item);
        item.status = item.references.length > 0 ? 'ready' : 'pending';
      }
      onProgress?.(
        'generate',
        `已生成 ${Math.min(start + BATCH, items.length)}/${items.length} 项说明`,
        55 + Math.round((Math.min(start + BATCH, items.length) / items.length) * 40),
      );
    }

    onProgress?.('done', '截图指导书生成完成', 100);

    const sorted = items.sort((a, b) => a.seq - b.seq);
    // 「重新匹配知识库」时，把上次人工勾选/状态/说明合并进新召回结果：
    // 已选 assetId 若仍在新候选池则保留（顺序沿用用户排列），失效的图剔除；全部失效回退默认。
    applySelections(sorted, opts.prevSelections ?? {});

    return {
      recordId,
      projectName: record.project_name || '未命名项目',
      schoolName: record.project_school ?? null,
      generatedAt: new Date().toISOString(),
      kbVersion: kbVersion?.version ?? null,
      items: sorted,
      totalScreenshots: sorted.filter((i) => i.mustCapture).length,
      matchedCount: sorted.filter((it) => it.references.length > 0).length,
      unmatchedCount: sorted.filter((it) => it.references.length === 0).length,
    };
  },
};

// =============== 持久化（screenshot_guides） ===============

/** 把每项的 referenceSources 候选池展开成 assetId → GuideReference 索引 */
function buildRefPool(item: GuideItem): Map<string, GuideReference> {
  const pool = new Map<string, GuideReference>();
  for (const src of item.referenceSources ?? []) {
    for (const ref of src.refs) {
      if (!pool.has(ref.assetId)) pool.set(ref.assetId, ref);
    }
  }
  return pool;
}

/** 找到某 assetId 所属来源（用于整组标题展示） */
function sourceOfAsset(item: GuideItem, assetId: string): ReferenceSource | null {
  for (const src of item.referenceSources ?? []) {
    if (src.refs.some((r) => r.assetId === assetId)) return src;
  }
  return null;
}

/**
 * 把人工决策（状态/勾选/说明）应用到机器生成的 items 上。
 * - 勾选：仅保留仍在候选池里的 assetId（按用户顺序）；若一项历史有勾选但全部失效，回退默认；
 * - 状态/说明：沿用人工值；未显式勾选的项保持机器默认。
 * 返回被应用过的有效决策合集（供落库，剔除失效项）。
 */
export function applySelections(items: GuideItem[], selections: GuideSelections): GuideSelections {
  const persisted: GuideSelections = {};
  for (const item of items) {
    const sel = selections[item.itemId];
    if (!sel) continue;

    if (sel.status === 'ready' || sel.status === 'pending' || sel.status === 'na') {
      item.status = sel.status;
    }
    if (typeof sel.instructionOverride === 'string' && sel.instructionOverride.trim()) {
      item.instruction = sel.instructionOverride;
    }

    if (Array.isArray(sel.selectedAssetIds)) {
      const pool = buildRefPool(item);
      const valid = sel.selectedAssetIds.filter((id): id is string => typeof id === 'string' && pool.has(id));
      if (valid.length > 0) {
        // 去重并保序
        const uniq = Array.from(new Set(valid));
        item.selectedAssetIds = uniq;
        item.references = uniq.map((id) => pool.get(id)!).filter(Boolean);
        // 组标题取首张选中图所属整组（跨组时展示主要来源）
        const firstSrc = sourceOfAsset(item, uniq[0]);
        item.referenceGroupTitle = firstSrc?.kind === 'group' ? firstSrc.title : null;
      } else if (sel.selectedAssetIds.length > 0) {
        // 历史勾选全部失效 → 保持机器默认（不覆盖），该决策不持久化
        continue;
      } else {
        // 用户显式清空
        item.selectedAssetIds = [];
        item.references = [];
        item.referenceGroupTitle = null;
      }
    }

    persisted[item.itemId] = {
      status: item.status,
      selectedAssetIds: item.selectedAssetIds,
      ...(sel.instructionOverride != null ? { instructionOverride: item.instruction } : {}),
    };
  }
  return persisted;
}

/**
 * 读取某招投标记录已保存的指导书（二次进入直接复用，不再跑 LLM/召回）。
 * 无记录返回 null。返回的 guide 已合并 guide_payload（机器结果）与 item_selections（人工决策）。
 */
export async function getSavedGuide(recordId: string): Promise<ScreenshotGuide | null> {
  const supabase = getAdminSupabase();
  const { data, error } = await supabase
    .from('screenshot_guides')
    .select('guide_payload, item_selections, kb_version')
    .eq('record_id', recordId)
    .maybeSingle();
  if (error) throw new Error(`读取已保存指导书失败: ${error.message}`);
  if (!data || !data.guide_payload) return null;

  const guide = data.guide_payload as ScreenshotGuide;
  const selections = (data.item_selections ?? {}) as GuideSelections;
  applySelections(guide.items, selections);
  // 重新汇总计数（合并勾选后可能变化）
  guide.matchedCount = guide.items.filter((it) => it.references.length > 0).length;
  guide.unmatchedCount = guide.items.filter((it) => it.references.length === 0).length;
  return guide;
}

/**
 * 保存/更新一份指导书（首次生成或重新匹配后落机器结果 + 人工决策）。
 * 机器结果写 guide_payload，人工决策写 item_selections。
 */
export async function upsertSavedGuide(
  recordId: string,
  guide: ScreenshotGuide,
  selections: GuideSelections,
  actor?: { id: string; displayName?: string | null },
): Promise<void> {
  const supabase = getAdminSupabase();
  const { error } = await supabase
    .from('screenshot_guides')
    .upsert(
      {
        record_id: recordId,
        kb_version: guide.kbVersion,
        guide_payload: guide as unknown as Record<string, unknown>,
        item_selections: selections,
        generated_at: new Date(guide.generatedAt).toISOString(),
        updated_by: actor?.id ?? null,
        updated_by_name: actor?.displayName ?? null,
      },
      { onConflict: 'record_id' },
    );
  if (error) throw new Error(`保存指导书失败: ${error.message}`);
}

/**
 * 仅更新人工决策（勾选/状态/说明的自动保存），不重算机器结果。
 * selections 为完整合集（前端每次提交当前全部决策），后端只保留引用合法 assetId 的项。
 */
export async function saveGuideSelections(
  recordId: string,
  selections: GuideSelections,
  actor?: { id: string; displayName?: string | null },
): Promise<void> {
  const supabase = getAdminSupabase();
  const { data, error: readErr } = await supabase
    .from('screenshot_guides')
    .select('guide_payload')
    .eq('record_id', recordId)
    .maybeSingle();
  if (readErr) throw new Error(`读取指导书失败: ${readErr.message}`);
  if (!data?.guide_payload) {
    // 尚未生成过指导书，忽略纯勾选保存
    return;
  }
  const guide = data.guide_payload as ScreenshotGuide;
  const cleaned = applySelections(guide.items, selections);

  const { error } = await supabase
    .from('screenshot_guides')
    .update({
      item_selections: cleaned,
      guide_payload: guide as unknown as Record<string, unknown>,
      updated_by: actor?.id ?? null,
      updated_by_name: actor?.displayName ?? null,
    })
    .eq('record_id', recordId);
  if (error) throw new Error(`保存勾选失败: ${error.message}`);
}

/** 读取已保存的人工决策（供「重新匹配知识库」时合并旧勾选） */
export async function getSavedSelections(recordId: string): Promise<GuideSelections> {
  const supabase = getAdminSupabase();
  const { data, error } = await supabase
    .from('screenshot_guides')
    .select('item_selections')
    .eq('record_id', recordId)
    .maybeSingle();
  if (error) throw new Error(`读取历史勾选失败: ${error.message}`);
  return (data?.item_selections ?? {}) as GuideSelections;
}

function mapReference(r: ParameterMapping): GuideReference {
  return {
    assetId: r.assetId ?? r.exampleId,
    storagePath: r.storagePath ?? null,
    exampleId: r.exampleId,
    visionNote: r.visionNote,
    evidenceElements: r.evidenceElements ?? [],
    confidence: r.confidence,
    sourceRecordId: r.sourceRecordId,
    sourceProjectName: r.example?.projectName ?? null,
  };
}

/** 把一个图组转成指导书 references（按文档 seq 顺序） */
function mapGroupReferences(group: ReferenceGroup): GuideReference[] {
  return group.assets.map((a, idx) => ({
    assetId: a.assetId,
    storagePath: null,
    exampleId: `group-${group.groupId}-${idx}`,
    visionNote: `图组第 ${a.seq + 1} 张（共 ${group.assets.length} 张）：${group.sectionTitle}`,
    evidenceElements: [],
    confidence: null,
    sourceRecordId: group.sourceRecordId,
    sourceProjectName: group.sourceProjectName,
  }));
}

function buildFileName(row: ScoreItemRow, idx: number): string {
  const safe = (row.title || '').replace(/[\\/:*?"<>|]/g, '').slice(0, 30).trim();
  return `${String(idx).padStart(2, '0')}-${safe || '截图'}.png`;
}

/** 无 LLM 输出时的兜底说明 */
function buildFallbackInstruction(item: GuideItem): string {
  if (item.references.length === 0) {
    return `暂未在知识库中匹配到「${item.title}」的参考截图。请进入相关功能模块，截取能完整展示该参数/功能的界面，并确保关键信息清晰可读。`;
  }
  const ref = item.references[0];
  return [
    `参考知识库中的示例截图${ref.visionNote ? `（${ref.visionNote}）` : ''}，进入对应功能模块。`,
    `截取能证明「${item.title}」满足招标要求的界面，需体现：${
      ref.evidenceElements?.length ? ref.evidenceElements.join('、') : '功能入口、关键参数值、页面标题'
    }。`,
    '截图应包含完整菜单路径与页面标题，避免截断关键数据。',
  ].join('\n');
}

async function generateInstructionsWithLlm(items: GuideItem[]): Promise<string[]> {
  const client = new LLMClient(new Config({ timeout: 180_000 }));
  const model = getModelForScenario('bidding-advice');

  const payload = items.map((it, i) => ({
    index: i,
    title: it.title,
    module: it.systemModule || '',
    requirement: it.requirement,
    hasReference: it.references.length > 0,
    references: it.references.slice(0, 2).map((r) => ({
      note: r.visionNote || '',
      evidence: r.evidenceElements || [],
      fromProject: r.sourceProjectName || '',
    })),
  }));

  const system = `你是招投标交付截图作业指导专家。根据每个评分项的招标要求和知识库中历史交付截图的视觉证据，生成简洁、可执行的截图作业说明。

每项说明必须回答三点：
1. 到系统的哪个模块/菜单（若参考图有页面路径则引用）；
2. 截什么画面、必须包含哪些可见元素（菜单标题、参数值、功能按钮等）；
3. 这张图如何证明满足招标要求。

严格要求：
- 每项 80-180 字，用中文，分条但不要用 Markdown 标题；
- 没有参考图的项，明确标注"暂无历史参考图"，给出通用截图建议，不要编造菜单路径；
- 只输出 JSON 数组，形如 ["说明1","说明2"]，顺序与输入一致，不要输出任何其他文字或代码块标记。`;

  const human = `请为以下 ${items.length} 个评分项生成截图作业说明：

${JSON.stringify(payload, null, 2)}`;

  try {
    let buffer = '';
    for await (const part of client.stream(
      [
        { role: 'system', content: system },
        { role: 'user', content: human },
      ],
      { model, temperature: 0.2 },
    )) {
      const text = part?.content?.toString?.() ?? '';
      if (text) buffer += text;
    }
    return parseInstructionsJson(buffer, items.length);
  } catch (err) {
    console.error('[screenshot-guide] LLM 生成说明失败:', err);
    return items.map(() => '');
  }
}

function parseInstructionsJson(text: string, expected: number): string[] {
  const cleaned = text.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) {
      const arr = parsed.map((x) => (typeof x === 'string' ? x : String(x ?? '')));
      while (arr.length < expected) arr.push('');
      return arr.slice(0, expected);
    }
  } catch {
    // 截断兜底
  }
  // 兜底：尝试抽取字符串数组
  const matches = Array.from(cleaned.matchAll(/"((?:[^"\\]|\\.)*)"/g)).map((m) =>
    m[1].replace(/\\"/g, '"').replace(/\\n/g, '\n'),
  );
  if (matches.length >= expected) return matches.slice(0, expected);
  const result = new Array<string>(expected).fill('');
  matches.forEach((m, i) => {
    if (i < expected) result[i] = m;
  });
  return result;
}
