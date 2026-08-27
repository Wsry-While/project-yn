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
} from "./parse/document-parser";
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
  ): Promise<BiddingDocument> {
    const supabase = getAdminSupabase();

    emit("step", { phase: "load", message: "读取招标文件…" });
    const record = await this.getRecordById(recordId);
    const fileRef = parseBiddingFile(record.projectBiddingFile);
    if (!fileRef || (!fileRef.assetId && !fileRef.url)) {
      throw new Error("未找到项目招标文件（请确认附件已转存完成，或销售提交时已附文件）");
    }

    emit("step", { phase: "parse", message: "解析招标文件…" });
    const parsed = fileRef.assetId
      ? await parseAssetDocument(fileRef.assetId)
      : await parseDocumentFromUrl(fileRef.url as string, fileRef.name);
    if (parsed.kind === "unsupported") {
      throw new Error(`暂不支持解析该文件类型（${parsed.fileName}），请上传 PDF 或 Word（.docx）。`);
    }
    const section = extractScoringSection(parsed.text);
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
      content: `已从 ${parsed.fileName}（${parsed.kind.toUpperCase()}，${Math.round(parsed.text.length / 100) / 10} 万字）定位到评分办法章节${section.matched ? `（命中「${section.matched}」）` : "（基于启发式定位）"}。\n\n【阶段 1/3】调用大模型解析评分规则与参数类型…\n\n`,
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
    const items = await extractRequirementsWithLlm(reqSection, rules, requestHeaders);
    if (!items.length) {
      throw new Error("未能从招标文件中抽取到评分项");
    }
    emit("delta", {
      content: `\n\n抽取完成：共 **${items.length}** 项交付点（重点参数 ${items.filter((i) => i.itemType === "key").length}、一般参数 ${items.filter((i) => i.itemType === "general").length}、演示 ${items.filter((i) => i.itemType === "demo").length}、文档 ${items.filter((i) => i.itemType === "document").length}）。\n\n【阶段 3/3】匹配截图知识库（仅截图类评分项）…\n\n`,
    });

    emit("step", { phase: "match", message: "阶段 3/3：匹配截图知识库…" });
    const matched = await matchExamplesForItems(supabase, items);

    const version = await nextVersion(supabase, recordId);

    // 清理旧评分项并写入新评分项
    await supabase.from("bidding_score_items").delete().eq("record_id", recordId);

    const rows = items.map((it, idx) => {
      const m = matched[idx];
      // 文档/演示类不走截图匹配，直接标 na（需要 PM 另行处理）
      const initialStatus: BiddingScoreItemStatus =
        it.deliveryMethod === "screenshot"
          ? m
            ? "matched"
            : "pending"
          : it.deliveryMethod === "document"
            ? "na"
            : it.deliveryMethod === "demo"
              ? "pending"
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

    const matchedCount = matched.filter(Boolean).length;
    const pendingCount = items.length - matchedCount;

    const { data: docData, error: docErr } = await supabase
      .from("bidding_documents")
      .insert({
        record_id: recordId,
        version,
        status: "ready" as const,
        docx_asset_id: null,
        pdf_asset_id: null,
        matched_count: matchedCount,
        pending_count: pendingCount,
        task_count: 0,
        error_message: null,
        generated_by: actor.id,
        generated_by_name: actor.name,
      } as never)
      .select("*")
      .single();
    if (docErr) throw new Error(`写入文档记录失败: ${docErr.message}`);

    emit("delta", { content: `\n\n${buildMatchSummary(items, matched)}` });
    emit("done", {
      documentId: (docData as DocumentRow).id,
      version,
      matchedCount,
      pendingCount,
      total: items.length,
    });

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
 */
async function extractRequirementsWithLlm(
  requirementsText: string,
  rules: RawScoreRules,
  requestHeaders?: Headers,
): Promise<RawScoreItem[]> {
  const prompt = buildBiddingRequirementsPrompt(requirementsText, rules);
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
  const items = parseScoreItemsJson(buffer);
  // 把阶段一的文档类评分项也合并进来（如果 LLM 没在采购需求里提到它们）
  const existing = new Set(items.map((i) => i.title.trim()));
  for (const d of rules.documentItems ?? []) {
    if (existing.has(d.title)) continue;
    items.push({
      itemNo: items.length + 1,
      title: d.title,
      requirement: d.rule ?? null,
      scoreValue: typeof d.maxScore === "number" ? d.maxScore : null,
      category: "文档",
      itemType: "document",
      deliveryMethod: "document",
      sourceSection: "评分办法-文档类",
    });
  }
  return items;
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
  // 去除 ```json 包裹
  const cleaned = text.replace(/```(?:json)?/gi, "").trim();
  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) return [];
  try {
    const arr = JSON.parse(cleaned.slice(start, end + 1));
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((it) => it && typeof it.title === "string")
      .map((it, idx) => ({
        itemNo: typeof it.itemNo === "number" ? it.itemNo : idx + 1,
        title: String(it.title).trim(),
        requirement: it.requirement != null ? String(it.requirement) : null,
        scoreValue: it.scoreValue != null ? Number(it.scoreValue) : null,
        category: it.category != null ? String(it.category) : null,
        itemType: normalizeItemType(it.itemType),
        deliveryMethod: normalizeDeliveryMethod(it.deliveryMethod),
        sourceSection:
          it.sourceSection != null ? String(it.sourceSection) : "采购需求",
      }));
  } catch {
    return [];
  }
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
