import { getAdminSupabase } from './api-utils';
import { LLMClient, Config } from 'coze-coding-dev-sdk';
import { getModelForScenario } from './llm-prompts';
import {
  ScreenshotExampleService,
  type ParameterMapping,
} from './screenshot-example-service';
import { ScreenshotKnowledgeService } from './screenshot-knowledge-service';

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
  /** 匹配到的参考截图。简单参数为单张功能截图；一条参数由多张截图响应时为整组（按文档顺序） */
  references: Array<{
    assetId: string;
    storagePath: string | null;
    exampleId: string;
    visionNote: string | null;
    evidenceElements: string[] | null;
    confidence: number | null;
    sourceRecordId: string | null;
    sourceProjectName: string | null;
  }>;
  /** 参考图来源的参数小节标题（整组匹配时有值，表示这组图共同响应同一条参数） */
  referenceGroupTitle?: string | null;
  /** LLM 生成的作业说明：到哪个模块/菜单、截什么、怎么证明满足要求 */
  instruction: string;
  /** 建议的截图文件名/编号 */
  suggestedFileName: string;
  /** 该项状态（前端用户可编辑）：pending(待补充) / ready(可截图) / na(本项目无此项) */
  status: 'pending' | 'ready' | 'na';
}

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
      let groupTitle: string | null = null;
      let refs: GuideItem['references'] = [];

      const group = await exampleService.searchReferenceGroup([row.title], {
        kbVersion: kbVersion?.version,
      });
      if (group && group.assets.length > 0) {
        groupTitle = group.sectionTitle;
        refs = group.assets.map((a, idx) => ({
          assetId: a.assetId,
          storagePath: null,
          exampleId: `group-${group.groupId}-${idx}`,
          visionNote: `图组第 ${a.seq + 1} 张（共 ${group.assets.length} 张）：${group.sectionTitle}`,
          evidenceElements: [],
          confidence: null,
          sourceRecordId: group.sourceRecordId,
          sourceProjectName: group.sourceProjectName,
        }));
      } else {
        const loose = await exampleService.searchByParameter([row.title], {
          limit: 3,
          kbVersion: kbVersion?.version,
        });
        refs = loose.map((r) => mapReference(r));
      }

      items.push({
        itemId: row.id,
        seq: row.item_no || row.order_index + 1 || i + 1,
        title: row.title,
        systemModule,
        requirement: row.requirement || row.title,
        score: row.score_value != null ? Number(row.score_value) : null,
        mustCapture: row.item_type !== 'general',
        references: refs,
        referenceGroupTitle: groupTitle,
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

    const matchedCount = items.filter((it) => it.references.length > 0).length;

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

    return {
      recordId,
      projectName: record.project_name || '未命名项目',
      schoolName: record.project_school ?? null,
      generatedAt: new Date().toISOString(),
      kbVersion: kbVersion?.version ?? null,
      items: items.sort((a, b) => a.seq - b.seq),
      totalScreenshots: items.filter((i) => i.mustCapture).length,
      matchedCount,
      unmatchedCount: items.length - matchedCount,
    };
  },
};

function mapReference(r: ParameterMapping): GuideItem['references'][number] {
  return {
    assetId: r.assetId ?? r.exampleId,
    storagePath: r.storagePath ?? null,
    exampleId: r.exampleId,
    visionNote: r.visionNote,
    evidenceElements: r.evidenceElements ?? [],
    confidence: r.confidence,
    sourceRecordId: r.sourceRecordId,
    sourceProjectName: null,
  };
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
