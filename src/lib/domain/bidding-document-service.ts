import { LLMClient, Config, HeaderUtils } from "coze-coding-dev-sdk";
import { getAdminSupabase } from "./api-utils";
import type {
  BiddingDocument,
  BiddingDocumentStatus,
  BiddingFollowupPriority,
  BiddingFollowupStatus,
  BiddingFollowupTask,
  BiddingScoreItem,
  BiddingScoreItemStatus,
  BiddingScreenshot,
} from "./types";
import { ScreenshotExampleService, type ScreenshotExample } from "./screenshot-example-service";
import {
  parseAssetDocument,
  parseDocumentFromUrl,
  extractScoringSection,
  extractRequirementsSection,
  chunkRequirementsText,
} from "./parse/document-parser";
import type { ParsedDocument } from "./parse/document-parser";
import {
  buildMessages,
  getModelForScenario,
  buildBiddingScoreRulesPrompt,
  buildBiddingRequirementsPrompt,
} from "./llm-prompts";
import { BiddingScreenshotService } from "./bidding-screenshot-service";

type Supabase = ReturnType<typeof getAdminSupabase>;
interface ScoreItemRow extends Record<string, unknown> {
  id: string;
  record_id: string;
  item_no: number;
  title: string;
  requirement: string | null;
  score_value: number | null;
  category: string | null;
  item_type: string | null;
  delivery_method: string | null;
  source_section: string | null;
  order_index: number;
  match_status: string;
  matched_example_id: string | null;
  matched_asset_id: string | null;
  task_id: string | null;
  delivery_asset_id: string | null;
  delivery_note: string | null;
  created_at: string;
  updated_at: string;
}
interface DocumentRow extends Record<string, unknown> {
  id: string;
  record_id: string;
  version: number;
  status: string;
  docx_asset_id: string | null;
  pdf_asset_id: string | null;
  matched_count: number;
  pending_count: number;
  task_count: number;
  error_message: string | null;
  generated_by: string | null;
  generated_by_name: string | null;
  created_at: string;
  updated_at: string;
}
interface FollowupTaskRow extends Record<string, unknown> {
  id: string;
  record_id: string;
  score_item_id: string | null;
  title: string;
  description: string | null;
  priority: string;
  status: string;
  assignee_id: string | null;
  external_assignee_name: string | null;
  external_assignee_contact: string | null;
  external_assignee_org: string | null;
  due_date: string | null;
  resolved_at: string | null;
  resolution_note: string | null;
  created_by: string | null;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
}

const SCORE_ITEMS_LIMIT = 500;

export interface ServerActor {
  id: string;
  name: string;
}

interface RawScoreItem {
  itemNo?: number;
  title: string;
  requirement?: string | null;
  scoreValue?: number | null;
  category?: string | null;
  itemType?: "key" | "general" | "demo" | "document" | "unknown";
  deliveryMethod?: "screenshot" | "demo" | "document" | "na";
  sourceSection?: string | null;
}

interface RawScoreRules {
  parameterRules?: {
    keyParamDeduction?: number | null;
    generalParamDeduction?: number | null;
    keyParamMarkers?: string[];
    ruleText?: string;
  } | null;
  demoRequired?: boolean;
  demoRuleText?: string;
  documentItems?: Array<{ title: string; maxScore?: number; rule?: string }>;
  totalTechScore?: number | null;
  notes?: string;
}

export type ProgressEmit = (type: "step" | "delta" | "done" | "error" | "meta", payload: unknown) => void;

/**
 * 生成结果预览（未入库）。前端展示后由用户人工确认，再调用 confirmDocument 持久化。
 */
export interface DocumentPreview {
  recordId: string;
  projectName: string;
  school: string | null;
  fileName: string;
  truncated: boolean;
  rules: {
    totalTechScore: number | null;
    keyParamDeduction: number | null;
    generalParamDeduction: number | null;
    demoRequired: boolean;
    documentItemCount: number;
  };
  items: Array<{
    itemNo: number;
    title: string;
    requirement: string | null;
    scoreValue: number | null;
    category: string | null;
    itemType: "key" | "general" | "demo" | "document" | "unknown";
    deliveryMethod: "screenshot" | "demo" | "document" | "na";
    sourceSection: string | null;
    matchedExample: ScreenshotExample | null;
  }>;
  matchedCount: number;
  pendingCount: number;
  total: number;
}

function parseBiddingFile(file: unknown): { assetId?: string; url?: string; name?: string } | null {
  if (!file) return null;
  if (Array.isArray(file)) return parseBiddingFile(file[0]);
  if (typeof file === "object") {
    const f = file as { assetId?: string; url?: string; name?: string };
    if (f.assetId) return { assetId: f.assetId, url: f.url, name: f.name };
    if (f.url && /^https?:\/\//i.test(f.url)) return { url: f.url, name: f.name };
  }
  return null;
}

/**
 * 把可能是单个/多个文件引用的字段，展开成全部候选文件引用列表。
 * 超星同一字段可能推送多个文件（如截图项.docx + 真实招标文件.docx），
 * 不能只取第一个，否则会用错文件、定位不到采购需求章节。
 */
function parseBiddingFiles(file: unknown): Array<{ assetId?: string; url?: string; name?: string }> {
  if (!file) return [];
  const arr = Array.isArray(file) ? file : [file];
  const out: Array<{ assetId?: string; url?: string; name?: string }> = [];
  for (const item of arr) {
    const ref = parseBiddingFile(item);
    if (ref && (ref.assetId || ref.url)) out.push(ref);
  }
  return out;
}

export const BiddingDocumentService = {
  async getLatestDocument(recordId: string) {
    const supabase = getAdminSupabase();
    const { data: doc, error } = await supabase
      .from("bidding_documents")
      .select("*")
      .eq("record_id", recordId)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`读取文档失败: ${error.message}`);
    if (!doc) return null;
    const [scoreItems, followupTasks] = await Promise.all([
      this.listScoreItems(recordId),
      this.listFollowupTasks(recordId),
    ]);
    return { ...mapDocument(doc as DocumentRow), scoreItems, followupTasks };
  },

  async listScoreItems(recordId: string): Promise<BiddingScoreItem[]> {
    const supabase = getAdminSupabase();
    const { data, error } = await supabase
      .from("bidding_score_items")
      .select(
        "*, matched_example:bidding_screenshot_examples(id, asset_id, description, system_module, page_path, tags, source), followup_task:bidding_followup_tasks(id, title, status, priority, assignee_id, external_assignee_name, external_assignee_org, due_date)",
      )
      .eq("record_id", recordId)
      .order("order_index", { ascending: true })
      .limit(SCORE_ITEMS_LIMIT);
    if (error) throw new Error(`读取评分项失败: ${error.message}`);
    return (data ?? []).map((row) => mapScoreItem(row as ScoreItemRow));
  },

  async listFollowupTasks(recordId: string): Promise<BiddingFollowupTask[]> {
    const supabase = getAdminSupabase();
    const { data, error } = await supabase
      .from("bidding_followup_tasks")
      .select("*")
      .eq("record_id", recordId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(`读取督办任务失败: ${error.message}`);
    return (data ?? []).map((row) => mapFollowupTask(row as FollowupTaskRow));
  },

  async getRecordById(recordId: string): Promise<BiddingScreenshot> {
    const supabase = getAdminSupabase();
    const service = new BiddingScreenshotService(supabase);
    const record = await service.getById(recordId);
    if (!record) throw new Error("招投标记录不存在");
    return record;
  },

  async generateDocument(
    recordId: string,
    actor: ServerActor,
    emit: ProgressEmit,
    requestHeaders?: Headers,
  ): Promise<DocumentPreview> {
    const supabase = getAdminSupabase();

    emit("step", { phase: "load", message: "读取招标文件…" });
    const record = await this.getRecordById(recordId);
    const fileRefs = parseBiddingFiles(record.projectBiddingFile);
    if (!fileRefs.length) {
      throw new Error("未找到项目招标文件（请确认附件已转存完成，或销售提交时已附文件）");
    }

    emit("step", { phase: "parse", message: "解析招标文件…" });
    // 同一字段可能有多份文件：逐份解析，优先选同时含「评分办法」与「采购需求」章节的那份；
    // 都不全时退化到评分办法最完整的一份，并在末尾给出更友好的提示。
    let parsed: ParsedDocument | null = null;
    let chosenScore: { text: string; matched: boolean | null } | null = null;
    let parsedSupport: { score: { text: string; matched: boolean | null }; parsed: ParsedDocument } | null = null;
    let firstSupported: ParsedDocument | null = null;
    const unsupportedNames: string[] = [];
    for (const ref of fileRefs) {
      let doc: ParsedDocument;
      try {
        doc = ref.assetId
          ? await parseAssetDocument(ref.assetId)
          : await parseDocumentFromUrl(ref.url as string, ref.name);
      } catch {
        continue;
      }
      if (doc.kind === "unsupported") {
        unsupportedNames.push(doc.fileName);
        continue;
      }
      if (!firstSupported) firstSupported = doc;
      const score = extractScoringSection(doc.text);
      const req = extractRequirementsSection(doc.text);
      if (!score.text.trim() || score.text.trim().length < 40) continue;
      if (req) {
        // 理想候选：评分办法 + 采购需求都在。
        parsed = doc;
        chosenScore = score;
        break;
      }
      // 暂存「有评分办法但缺采购需求」的候选，最后兜底。
      if (!parsedSupport || score.text.length > parsedSupport.score.text.length) {
        parsedSupport = { score, parsed: doc };
      }
    }

    if (!parsed && parsedSupport) {
      parsed = parsedSupport.parsed;
      chosenScore = parsedSupport.score;
    } else if (!parsed && firstSupported) {
      parsed = firstSupported;
      chosenScore = extractScoringSection(parsed.text);
    }

    if (!parsed) {
      if (unsupportedNames.length && unsupportedNames.length === fileRefs.length) {
        throw new Error(`暂不支持解析该文件类型（${unsupportedNames.join("、")}），请上传 PDF 或 Word（.docx）。`);
      }
      throw new Error("未能从招标文件中识别到「评分办法」章节");
    }
    const section = chosenScore as { text: string; matched: boolean | null };
    if (!section.text.trim() || section.text.trim().length < 40) {
      throw new Error("未能从招标文件中识别到「评分办法」章节");
    }
    emit("meta", {
      projectName: record.projectName,
      school: record.projectSchool,
      fileName: parsed.fileName,
      truncated: parsed.truncated,
    });
    emit("delta", {
      content: `已从 ${parsed.fileName}（${parsed.kind.toUpperCase()}，${Math.round(parsed.text.length / 100) / 10} 万字）定位到评分办法章节${section.matched ? "" : "（基于启发式定位）"}。\n\n【阶段 1/3】调用大模型解析评分规则与参数类型…\n\n`,
    });

    emit("step", { phase: "llm", message: "阶段 1/3：解析评分规则…" });
    const rules = await extractScoreRulesWithLlm(section.text, requestHeaders);
    emit("delta", {
      content: `评分规则解析完成：技术部分总分 **${rules.totalTechScore ?? "?"}**，重点参数扣分 **${rules.parameterRules?.keyParamDeduction ?? "?"}**/条，一般参数扣分 **${rules.parameterRules?.generalParamDeduction ?? "?"}**/条，演示要求：**${rules.demoRequired ? "有" : "无"}**，文档类评分项 **${rules.documentItems?.length ?? 0}** 项。\n\n【阶段 2/3】定位采购需求章节并归纳交付项…\n\n`,
    });

    const reqSection = extractRequirementsSection(parsed.text);
    if (!reqSection) {
      throw new Error("未能从招标文件中定位到采购需求/技术要求章节");
    }
    emit("delta", {
      content: `已截取采购需求章节（${reqSection.length} 字），正在归纳截图/演示/文档类交付项…\n\n`,
    });

    emit("step", { phase: "llm", message: "阶段 2/3：归纳交付项…" });
    const items = await extractRequirementsWithLlm(
      reqSection,
      rules,
      { screenshotRequirement: record.screenshotRequirement },
      requestHeaders,
      (msg) => emit("delta", { content: msg }),
    );
    if (!items.length) {
      throw new Error(
        "未能从招标文件中抽取到评分项（采购需求可能过长或输出被截断，请检查招标文件或联系管理员）",
      );
    }
    const keyCount = items.filter((i) => i.itemType === "key").length;
    const generalCount = items.filter((i) => i.itemType === "general").length;
    const demoCount = items.filter((i) => i.itemType === "demo").length;
    const screenshotTotal = items.filter((i) => i.deliveryMethod === "screenshot").length;
    const demoTotal = items.filter((i) => i.deliveryMethod === "demo").length;
    emit("delta", {
      content: `\n\n抽取完成：共 **${items.length}** 项交付点（重点参数 ${keyCount}、一般参数 ${generalCount}、演示 ${demoCount}）。其中 **需截图 ${screenshotTotal} 项**、需演示 ${demoTotal} 项。\n\n【阶段 3/3】匹配截图知识库（仅截图类评分项）…\n\n`,
    });

    emit("step", { phase: "match", message: "阶段 3/3：匹配截图知识库…" });
    const matched = await matchExamplesForItems(supabase, items);

    const matchedCount = matched.filter(Boolean).length;
    const pendingCount = items.length - matchedCount;

    emit("delta", { content: `\n\n${buildMatchSummary(items, matched)}` });
    emit("delta", {
      content:
        "\n\n**抽取完成，请在下方核对评分项，确认无误后点击「确认入库」；如需调整可取消后重新生成。**\n\n",
    });

    const preview: DocumentPreview = {
      recordId,
      projectName: record.projectName,
      school: record.projectSchool,
      fileName: parsed.fileName,
      truncated: parsed.truncated,
      rules: {
        totalTechScore: rules.totalTechScore ?? null,
        keyParamDeduction: rules.parameterRules?.keyParamDeduction ?? null,
        generalParamDeduction: rules.parameterRules?.generalParamDeduction ?? null,
        demoRequired: rules.demoRequired ?? false,
        documentItemCount: rules.documentItems?.length ?? 0,
      },
      items: items.map((it, idx) => ({
        itemNo: it.itemNo ?? idx + 1,
        title: it.title,
        requirement: it.requirement ?? null,
        scoreValue: it.scoreValue ?? null,
        category: it.category ?? null,
        itemType: it.itemType ?? "unknown",
        deliveryMethod: it.deliveryMethod ?? "na",
        sourceSection: it.sourceSection ?? null,
        matchedExample: matched[idx] ?? null,
      })),
      matchedCount,
      pendingCount,
      total: items.length,
    };

    emit("done", {
      preview,
      matchedCount,
      pendingCount,
      total: items.length,
    });

    return preview;
  },

  /**
   * 人工确认预览结果后正式入库：写入 bidding_documents + bidding_score_items。
   * 二次生成（已有文档）时调用方需校验超管权限。
   */
  async confirmDocument(
    preview: DocumentPreview,
    actor: ServerActor,
  ): Promise<BiddingDocument> {
    const supabase = getAdminSupabase();
    const { recordId, items } = preview;
    const version = await nextVersion(supabase, recordId);

    // 清理旧评分项并写入新评分项
    await supabase.from("bidding_score_items").delete().eq("record_id", recordId);

    const rows = items.map((it, idx) => {
      const m = it.matchedExample;
      const initialStatus: BiddingScoreItemStatus =
        it.deliveryMethod === "screenshot"
          ? m
            ? "matched"
            : "pending"
          : it.deliveryMethod === "document"
            ? "na"
            : "pending";
      return {
        record_id: recordId,
        item_no: it.itemNo ?? idx + 1,
        title: it.title,
        requirement: it.requirement ?? null,
        score_value: it.scoreValue ?? null,
        category: it.category ?? null,
        item_type: it.itemType ?? "general",
        delivery_method: it.deliveryMethod ?? "screenshot",
        source_section: it.sourceSection ?? null,
        order_index: idx,
        match_status: initialStatus,
        matched_example_id: m?.id ?? null,
        matched_asset_id: m?.assetId ?? null,
        task_id: null,
        delivery_asset_id: null,
        delivery_note: null,
      } as const;
    });

    const { error: insertErr } = await supabase
      .from("bidding_score_items")
      .insert(rows as never);
    if (insertErr) throw new Error(`写入评分项失败: ${insertErr.message}`);

    const { data: docData, error: docErr } = await supabase
      .from("bidding_documents")
      .insert({
        record_id: recordId,
        version,
        status: "ready" as const,
        docx_asset_id: null,
        pdf_asset_id: null,
        matched_count: preview.matchedCount,
        pending_count: preview.pendingCount,
        task_count: 0,
        error_message: null,
        generated_by: actor.id,
        generated_by_name: actor.name,
      } as never)
      .select("*")
      .single();
    if (docErr) throw new Error(`写入文档记录失败: ${docErr.message}`);

    return mapDocument(docData as DocumentRow);
  },

  async updateScoreItem(
    itemId: string,
    patch: {
      matchStatus?: BiddingScoreItemStatus;
      deliveryAssetId?: string | null;
      deliveryNote?: string | null;
      taskId?: string | null;
    },
  ): Promise<BiddingScoreItem> {
    const supabase = getAdminSupabase();
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (patch.matchStatus) updates.match_status = patch.matchStatus;
    if (patch.deliveryAssetId !== undefined) updates.delivery_asset_id = patch.deliveryAssetId;
    if (patch.deliveryNote !== undefined) updates.delivery_note = patch.deliveryNote;
    if (patch.taskId !== undefined) updates.task_id = patch.taskId;

    const { data, error } = await supabase
      .from("bidding_score_items")
      .update(updates as never)
      .eq("id", itemId)
      .select("*")
      .single();
    if (error) throw new Error(`更新评分项失败: ${error.message}`);
    return mapScoreItem(data as ScoreItemRow);
  },

  async getScoreItem(itemId: string): Promise<BiddingScoreItem & { recordId: string }> {
    const supabase = getAdminSupabase();
    const { data, error } = await supabase
      .from("bidding_score_items")
      .select("*")
      .eq("id", itemId)
      .single();
    if (error) throw new Error(`评分项不存在: ${error.message}`);
    return mapScoreItem(data as ScoreItemRow);
  },

  async createFollowupTask(input: {
    recordId: string;
    scoreItemId?: string | null;
    title: string;
    description?: string | null;
    priority: BiddingFollowupPriority;
    assigneeId?: string | null;
    externalAssigneeName?: string | null;
    externalAssigneeContact?: string | null;
    externalAssigneeOrg?: string | null;
    dueDate?: string | null;
    actor: ServerActor;
  }): Promise<BiddingFollowupTask> {
    const supabase = getAdminSupabase();
    const { data, error } = await supabase
      .from("bidding_followup_tasks")
      .insert({
        record_id: input.recordId,
        score_item_id: input.scoreItemId ?? null,
        title: input.title,
        description: input.description ?? null,
        priority: input.priority,
        status: "todo",
        assignee_id: input.assigneeId ?? null,
        external_assignee_name: input.externalAssigneeName ?? null,
        external_assignee_contact: input.externalAssigneeContact ?? null,
        external_assignee_org: input.externalAssigneeOrg ?? null,
        due_date: input.dueDate ?? null,
        created_by: input.actor.id,
        created_by_name: input.actor.name,
      } as never)
      .select("*")
      .single();
    if (error) throw new Error(`创建督办任务失败: ${error.message}`);

    if (input.scoreItemId) {
      await this.updateScoreItem(input.scoreItemId, {
        matchStatus: "task_created",
        taskId: (data as FollowupTaskRow).id,
      });
      await recalcDocumentCounters(supabase, input.recordId);
    }
    return mapFollowupTask(data as FollowupTaskRow);
  },

  async updateFollowupTask(
    taskId: string,
    patch: { status?: BiddingFollowupStatus; resolutionNote?: string | null },
  ): Promise<BiddingFollowupTask> {
    const supabase = getAdminSupabase();
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (patch.status) {
      updates.status = patch.status;
      if (patch.status === "done") updates.resolved_at = new Date().toISOString();
    }
    if (patch.resolutionNote !== undefined) updates.resolution_note = patch.resolutionNote;
    const { data, error } = await supabase
      .from("bidding_followup_tasks")
      .update(updates as never)
      .eq("id", taskId)
      .select("*")
      .single();
    if (error) throw new Error(`更新督办任务失败: ${error.message}`);
    const task = data as FollowupTaskRow;
    if (patch.status === "done" && task.score_item_id) {
      await this.updateScoreItem(task.score_item_id, { matchStatus: "pending" });
      await recalcDocumentCounters(supabase, task.record_id);
    }
    return mapFollowupTask(task);
  },

  async listTeamMembers(): Promise<Array<{ id: string; name: string }>> {
    const supabase = getAdminSupabase();
    const { data, error } = await supabase
      .from("team_members")
      .select("id,name")
      .eq("active", true)
      .order("name");
    if (error) return [];
    return (data ?? []) as Array<{ id: string; name: string }>;
  },
};

// ============== helpers ==============

async function nextVersion(supabase: Supabase, recordId: string): Promise<number> {
  const { data } = await supabase
    .from("bidding_documents")
    .select("version")
    .eq("record_id", recordId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  return ((data as { version?: number } | null)?.version ?? 0) + 1;
}

async function recalcDocumentCounters(supabase: Supabase, recordId: string): Promise<void> {
  const [{ count: matched }, { count: task }, { count: pending }] = await Promise.all([
    supabase
      .from("bidding_score_items")
      .select("id", { count: "exact", head: true })
      .eq("record_id", recordId)
      .in("match_status", ["matched", "uploaded"]),
    supabase
      .from("bidding_score_items")
      .select("id", { count: "exact", head: true })
      .eq("record_id", recordId)
      .eq("match_status", "task_created"),
    supabase
      .from("bidding_score_items")
      .select("id", { count: "exact", head: true })
      .eq("record_id", recordId)
      .eq("match_status", "pending"),
  ]);
  await supabase
    .from("bidding_documents")
    .update({
      matched_count: matched ?? 0,
      task_count: task ?? 0,
      pending_count: pending ?? 0,
      updated_at: new Date().toISOString(),
    } as never)
    .eq("record_id", recordId);
}

function mapDocument(row: DocumentRow): BiddingDocument {
  return {
    id: row.id,
    recordId: row.record_id,
    version: row.version,
    status: row.status as BiddingDocumentStatus,
    docxAssetId: row.docx_asset_id,
    pdfAssetId: row.pdf_asset_id,
    matchedCount: row.matched_count,
    pendingCount: row.pending_count,
    taskCount: row.task_count,
    errorMessage: row.error_message,
    generatedByName: row.generated_by_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapScoreItem(row: ScoreItemRow): BiddingScoreItem {
  const r = row as ScoreItemRow & {
    matched_example?: {
      id: string;
      asset_id: string | null;
      description: string | null;
      system_module: string | null;
      school: string | null;
      project_name: string | null;
    } | null;
    followup_task?: FollowupTaskRow | null;
  };
  return {
    id: r.id,
    recordId: r.record_id,
    itemNo: r.item_no,
    title: r.title,
    requirement: r.requirement,
    scoreValue: r.score_value,
    category: r.category,
    itemType: (r.item_type as BiddingScoreItem["itemType"]) ?? "unknown",
    deliveryMethod:
      (r.delivery_method as BiddingScoreItem["deliveryMethod"]) ?? "screenshot",
    sourceSection: r.source_section ?? null,
    orderIndex: r.order_index,
    matchStatus: r.match_status as BiddingScoreItemStatus,
    matchedExampleId: r.matched_example_id,
    matchedAssetId: r.matched_asset_id,
    taskId: r.task_id,
    deliveryAssetId: r.delivery_asset_id,
    deliveryNote: r.delivery_note,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    matchedExample: r.matched_example
      ? {
          id: r.matched_example.id,
          assetId: r.matched_example.asset_id,
          description: r.matched_example.description,
          systemModule: r.matched_example.system_module,
          pagePath: (r.matched_example as { page_path?: string | null }).page_path ?? null,
          tags: (r.matched_example as { tags?: string[] | null }).tags ?? null,
          source: (r.matched_example as { source?: string | null }).source ?? null,
        }
      : null,
    followupTask: r.followup_task ? mapFollowupTask(r.followup_task) : null,
  };
}

function mapFollowupTask(row: FollowupTaskRow): BiddingFollowupTask {
  return {
    id: row.id,
    recordId: row.record_id,
    scoreItemId: row.score_item_id,
    title: row.title,
    description: row.description,
    priority: row.priority as BiddingFollowupPriority,
    status: row.status as BiddingFollowupStatus,
    assigneeId: row.assignee_id,
    externalAssigneeName: row.external_assignee_name,
    externalAssigneeContact: row.external_assignee_contact,
    externalAssigneeOrg: row.external_assignee_org,
    dueDate: row.due_date,
    resolvedAt: row.resolved_at,
    resolutionNote: row.resolution_note,
    createdByName: row.created_by_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ============== LLM 抽取（两阶段） ==============

/**
 * 阶段一：从评分办法章节抽取规则结构。
 */
async function extractScoreRulesWithLlm(
  sectionText: string,
  requestHeaders?: Headers,
): Promise<RawScoreRules> {
  const prompt = buildBiddingScoreRulesPrompt(sectionText);
  const customHeaders = requestHeaders
    ? HeaderUtils.extractForwardHeaders(requestHeaders)
    : undefined;
  const client = new LLMClient(new Config({ timeout: 180_000 }), customHeaders);

  let buffer = "";
  for await (const part of client.stream(
    buildMessages({ scenario: "bidding-score", prompt }),
    {
      model: getModelForScenario("bidding-score"),
      temperature: 0.1,
    },
  )) {
    const text = part?.content?.toString?.() ?? "";
    if (text) buffer += text;
  }
  return parseRulesJson(buffer);
}

/**
 * 阶段二：基于规则 + 采购需求章节，拆解每一条交付项。
 * 超长采购需求按"功能模块/标题级别"分块，每块独立调用 LLM（控制并发），
 * 最后合并、去重、重新编号，避免单次输出 token 上限导致 JSON 被截断。
 */
interface ExtractOptions {
  /** 招投标记录中的"截图需求说明"字段，用于决定一般参数是否需要截图 */
  screenshotRequirement?: string | null;
}

/**
 * 判断"截图需求说明"是否明确要求一般参数也需要截图。
 * 销售在该字段通常会写明截图范围，如"所有技术参数均需截图"、"一般参数也需提供截图"等。
 * 若字段为空或仅提及重点参数（▲/实质性/重要参数），则一般参数不进入截图交付清单。
 */
function generalParamNeedsScreenshot(screenshotRequirement?: string | null): boolean {
  if (!screenshotRequirement) return false;
  const text = screenshotRequirement.trim();
  if (text.length === 0) return false;
  // 明确表达"全部/所有参数都要截图"或点名"一般参数也要截图"
  if (/(所有|全部|每个|各项|每条|任意).{0,8}(参数|功能|技术|截图)/.test(text)) return true;
  if (/(一般参数|普通参数|非重点|非实质性).{0,8}(也|均|都|需要|需|要).{0,4}截图/.test(text)) {
    return true;
  }
  if (/截图.{0,6}(所有|全部|每个|各项|每条|一般参数|普通参数)/.test(text)) return true;
  // 仅要求重点参数/实质性/▲ 截图的，明确不包含一般参数
  if (/(仅|只|只有).{0,6}(重点|实质性|重要|▲|★)/.test(text)) return false;
  // 默认：字段存在但未明确要求一般参数时，只保留重点参数截图
  return false;
}

async function extractRequirementsWithLlm(
  requirementsText: string,
  rules: RawScoreRules,
  options: ExtractOptions = {},
  requestHeaders?: Headers,
  onProgress?: (msg: string) => void,
): Promise<RawScoreItem[]> {
  const keepGeneralScreenshot = generalParamNeedsScreenshot(options.screenshotRequirement);
  const finalize = (raw: RawScoreItem[]) =>
    finalizeItems(raw, { keepGeneralScreenshot, screenshotRequirement: options.screenshotRequirement });

  const chunks = chunkRequirementsText(requirementsText, { targetChars: 9000 });

  // 采购需求较短（仅一块且不超长）时，走单次抽取（保持原有行为）
  if (chunks.length <= 1) {
    const buffer = await callRequirementsLlm(
      buildBiddingRequirementsPrompt(requirementsText, rules),
      requestHeaders,
    );
    const items = parseScoreItemsJson(buffer);
    if (!items.length) {
      console.warn(
        "[bidding/extract-requirements] LLM 返回无法解析为评分项数组，原文尾部：",
        buffer.slice(-500),
      );
    }
    return finalize(items);
  }

  onProgress?.(
    `采购需求较长（${requirementsText.length} 字），已按功能模块拆分为 **${chunks.length}** 块并行抽取…\n\n`,
  );

  const customHeaders = requestHeaders
    ? HeaderUtils.extractForwardHeaders(requestHeaders)
    : undefined;

  // 限制并发数为 3，避免一次性发起过多 LLM 请求
  const CONCURRENCY = 3;
  const collected: RawScoreItem[] = [];
  let cursor = 0;
  let completed = 0;

  async function worker() {
    while (true) {
      const myIdx = cursor++;
      if (myIdx >= chunks.length) return;
      const chunk = chunks[myIdx];
      try {
        const prompt = buildBiddingRequirementsPrompt(chunk.text, rules, {
          index: chunk.index,
          total: chunks.length,
          title: chunk.title,
        });
        // 复用同一个 client 配置，但每块独立请求
        const client = new LLMClient(new Config({ timeout: 180_000 }), customHeaders);
        let buffer = "";
        for await (const part of client.stream(
          buildMessages({ scenario: "bidding-score", prompt }),
          {
            model: getModelForScenario("bidding-score"),
            temperature: 0.1,
          },
        )) {
          const text = part?.content?.toString?.() ?? "";
          if (text) buffer += text;
        }
        const chunkItems = parseScoreItemsJson(buffer);
        if (!chunkItems.length) {
          console.warn(
            `[bidding/extract-requirements] 块「${chunk.title}」无法解析，原文尾部：`,
            buffer.slice(-300),
          );
        }
        collected.push(...chunkItems);
      } catch (err) {
        console.warn(`[bidding/extract-requirements] 块「${chunk.title}」抽取失败：`, err);
      } finally {
        completed++;
        onProgress?.(`▸ 已完成模块 ${completed}/${chunks.length}：${chunk.title}（累计 ${collected.length} 项）\n`);
      }
    }
  }

  const runners = Array.from({ length: Math.min(CONCURRENCY, chunks.length) }, () => worker());
  await Promise.all(runners);

  if (!keepGeneralScreenshot) {
    onProgress?.(
      `▸ 按「截图需求说明」过滤：未要求一般参数截图，仅保留重点参数与演示项…\n`,
    );
  }

  return finalize(collected);
}

/**
 * 单次调用阶段二 LLM 并返回完整文本（供短文档走单次路径）。
 */
async function callRequirementsLlm(
  prompt: string,
  requestHeaders?: Headers,
): Promise<string> {
  const customHeaders = requestHeaders
    ? HeaderUtils.extractForwardHeaders(requestHeaders)
    : undefined;
  const client = new LLMClient(new Config({ timeout: 180_000 }), customHeaders);
  let buffer = "";
  for await (const part of client.stream(
    buildMessages({ scenario: "bidding-score", prompt }),
    {
      model: getModelForScenario("bidding-score"),
      temperature: 0.1,
    },
  )) {
    const text = part?.content?.toString?.() ?? "";
    if (text) buffer += text;
  }
  return buffer;
}

/**
 * 统一后处理：去重、重新编号、文档类黑名单过滤、itemType/deliveryMethod 归一化。
 */
function finalizeItems(
  items: RawScoreItem[],
  opts: { keepGeneralScreenshot: boolean; screenshotRequirement?: string | null } = {
    keepGeneralScreenshot: true,
  },
): RawScoreItem[] {
  if (!items.length) return [];
  // 后处理：过滤掉 LLM 可能仍然返回的文档类项（实施方案、培训、业绩等），
  // 并对 itemType/deliveryMethod 做归一化
  const documentBlocklist = [
    /实施方案/, /安全.*(方案|保密|保障|措施)/, /服务团队/, /项目负责人.*经验/,
    /人员配置/, /人员资质/, /培训方案/, /培训计划/, /售后服务/, /服务承诺/,
    /保证措施/, /类似业绩/, /业绩/, /合同案例/, /质量管理体系/, /验收方案/,
    /投资估算/, /报价说明/, /商务条款/, /资质要求/, /资格要求/,
  ];
  const filtered = items.filter((it) => {
    if (it.itemType === "document" || it.deliveryMethod === "document") return false;
    const title = (it.title ?? "").trim();
    if (!title) return false;
    if (documentBlocklist.some((re) => re.test(title))) return false;
    // 截图需求说明未要求一般参数截图时，剔除「一般参数 + 截图」类项；
    // 一般参数若需要演示（demo）则保留，重点参数（key）始终保留。
    if (
      !opts.keepGeneralScreenshot &&
      (it.itemType === "general" || it.itemType === "unknown") &&
      it.deliveryMethod !== "demo"
    ) {
      return false;
    }
    return true;
  });

  // 去重：按 title 归一化（去空白/标点/▲★●）判重，保留首次出现
  const seen = new Set<string>();
  const deduped: RawScoreItem[] = [];
  for (const it of filtered) {
    const norm = (it.title ?? "").replace(/[\s▲★●、，,。.（）()【】\[\]]/g, "").toLowerCase();
    if (norm.length < 3 || seen.has(norm)) continue;
    seen.add(norm);
    deduped.push(it);
  }

  // 归一化 + 重新连续编号
  return deduped.map((it, idx) => {
    const itemType =
      it.itemType === "key" || it.itemType === "demo" || it.itemType === "general"
        ? it.itemType
        : "general";
    const deliveryMethod =
      it.deliveryMethod === "screenshot" || it.deliveryMethod === "demo"
        ? it.deliveryMethod
        : "screenshot";
    return {
      ...it,
      itemNo: idx + 1,
      itemType,
      deliveryMethod,
      sourceSection: it.sourceSection ?? "采购需求",
    };
  });
}

function parseRulesJson(text: string): RawScoreRules {
  const cleaned = text.replace(/```(?:json)?/gi, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return {};
  try {
    const obj = JSON.parse(cleaned.slice(start, end + 1));
    return obj && typeof obj === "object" ? (obj as RawScoreRules) : {};
  } catch {
    return {};
  }
}

function parseScoreItemsJson(text: string): RawScoreItem[] {
  // 去除 ```json 等代码块包裹
  let cleaned = text.replace(/```(?:json)?/gi, "").trim();

  // 1) 优先定位数组
  let arrStart = cleaned.indexOf("[");
  let arrEnd = cleaned.lastIndexOf("]");
  let arr: unknown = null;
  if (arrStart !== -1 && arrEnd > arrStart) {
    try {
      arr = JSON.parse(cleaned.slice(arrStart, arrEnd + 1));
    } catch {
      arr = null;
    }
  }
  // 2) 回退：LLM 有时会包一层 { items: [...] } 或 { data: [...] }
  if (!Array.isArray(arr)) {
    const objStart = cleaned.indexOf("{");
    const objEnd = cleaned.lastIndexOf("}");
    if (objStart !== -1 && objEnd > objStart) {
      try {
        const obj = JSON.parse(cleaned.slice(objStart, objEnd + 1)) as Record<string, unknown>;
        if (Array.isArray(obj.items)) arr = obj.items;
        else if (Array.isArray(obj.data)) arr = obj.data;
        else if (Array.isArray(obj.result)) arr = obj.result;
        else if (Array.isArray(obj.scoreItems)) arr = obj.scoreItems;
      } catch {
        // ignore
      }
    }
  }
  // 3) 最后兜底：尝试修复常见 LLM 输出问题（尾逗号、单引号）
  if (!Array.isArray(arr)) {
    try {
      const fixed = cleaned
        .replace(/,\s*([}\]])/g, "$1")
        .replace(/'([^']*)'/g, (_, s: string) => `"${s.replace(/"/g, '\\"')}"`);
      const start = fixed.indexOf("[");
      const end = fixed.lastIndexOf("]");
      if (start !== -1 && end > start) {
        arr = JSON.parse(fixed.slice(start, end + 1));
      }
    } catch {
      // ignore
    }
  }
  // 4) 截断兜底：LLM 输出被 token 上限截断，数组缺少闭合 ]。
  //    回退到最后一个完整对象边界 `},` 或 `}`，补 `]` 后再解析，保住前面所有完整项。
  if (!Array.isArray(arr)) {
    const start = cleaned.indexOf("[");
    if (start !== -1) {
      const body = cleaned.slice(start + 1);
      const lastComplete = Math.max(body.lastIndexOf("},"), body.lastIndexOf("}\n"));
      if (lastComplete > 0) {
        const candidate = "[" + body.slice(0, lastComplete + 1).replace(/,\s*$/, "") + "]";
        try {
          const parsed = JSON.parse(candidate);
          if (Array.isArray(parsed)) arr = parsed;
        } catch {
          // ignore
        }
      }
    }
  }
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((it): it is Record<string, unknown> => !!it && typeof it === "object")
    .map((it, idx) => ({
      itemNo: typeof it.itemNo === "number" ? it.itemNo : idx + 1,
      title: String(it.title ?? it.name ?? "").trim(),
      requirement: it.requirement != null ? String(it.requirement) : null,
      scoreValue: it.scoreValue != null ? Number(it.scoreValue) : null,
      category: it.category != null ? String(it.category) : null,
      itemType: normalizeItemType(it.itemType),
      deliveryMethod: normalizeDeliveryMethod(it.deliveryMethod),
      sourceSection:
        it.sourceSection != null ? String(it.sourceSection) : "采购需求",
    }))
    .filter((it) => it.title.length > 0);
}

// ============== 匹配知识库 ==============

async function matchExamplesForItems(
  supabase: Supabase,
  items: RawScoreItem[],
): Promise<Array<ScreenshotExample | null>> {
  const exampleService = new ScreenshotExampleService(supabase);
  const results: Array<ScreenshotExample | null> = [];
  for (const it of items) {
    // 只有需要截图的评分项才走知识库匹配
    if (it.deliveryMethod && it.deliveryMethod !== "screenshot") {
      results.push(null);
      continue;
    }
    try {
      const keywords = buildKeywords(it);
      const list = await exampleService.search(keywords, 1);
      if (list.length > 0 && list[0].assetId) {
        results.push(list[0]);
      } else {
        results.push(null);
      }
    } catch {
      results.push(null);
    }
  }
  return results;
}

function buildKeywords(it: RawScoreItem): string[] {
  const text = `${it.title ?? ""} ${it.requirement ?? ""} ${it.category ?? ""}`;
  const tokens = text
    .split(/[\s,，。；;：:、（）()【】\[\]"'""''\/\\\-—·.…!?！？\d]+/g)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2 && s.length <= 12);
  return Array.from(new Set(tokens)).slice(0, 6);
}

function normalizeItemType(v: unknown): RawScoreItem["itemType"] {
  if (v === "key" || v === "general" || v === "demo" || v === "document") return v;
  if (typeof v === "string") {
    const s = v.toLowerCase();
    if (s.includes("key") || s.includes("重点") || s.includes("星") || s.includes("▲")) return "key";
    if (s.includes("demo") || s.includes("演示")) return "demo";
    if (s.includes("doc") || s.includes("文档") || s.includes("资质")) return "document";
  }
  return "general";
}

function normalizeDeliveryMethod(v: unknown): RawScoreItem["deliveryMethod"] {
  if (v === "screenshot" || v === "demo" || v === "document" || v === "na") return v;
  if (typeof v === "string") {
    const s = v.toLowerCase();
    if (s.includes("screen") || s.includes("截图")) return "screenshot";
    if (s.includes("demo") || s.includes("演示")) return "demo";
    if (s.includes("doc") || s.includes("文档")) return "document";
  }
  return "screenshot";
}

function buildMatchSummary(items: RawScoreItem[], matched: Array<unknown>): string {
  const matchedCount = matched.filter(Boolean).length;
  const pendingCount = items.length - matchedCount;
  const pct = Math.round((matchedCount / items.length) * 100);
  const pendingItems = items.filter((_, i) => !matched[i]).slice(0, 5);
  const pendingList = pendingItems.map((it, i) => `  ${i + 1}. ${it.title}`).join("\n");
  return [
    "### 匹配结果",
    "",
    `- 总评分项：**${items.length}**`,
    `- 知识库命中：**${matchedCount}**（${pct}%）`,
    `- 待补充截图：**${pendingCount}**`,
    pendingCount > 0 && pendingList
      ? `\n前几项待补充：\n${pendingList}${pendingCount > 5 ? `\n  …（共 ${pendingCount} 项）` : ""}\n\n请在评分项列表中处理标黄项。`
      : "\n全部评分项已命中知识库，可直接下载文档。",
  ].join("\n");
}

export type { RawScoreItem };
