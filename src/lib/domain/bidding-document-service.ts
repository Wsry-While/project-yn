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
import { parseAssetDocument, parseDocumentFromUrl, extractScoringSection } from "./parse/document-parser";
import { buildMessages, getModelForScenario } from "./llm-prompts";
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
        "*, matched_example:bidding_screenshot_examples(id, asset_id, description, system_module, school, project_name), followup_task:bidding_followup_tasks(id, title, status, priority, assignee_id, external_assignee_name, external_assignee_org, due_date)",
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
    if (!fileRef?.assetId) {
      throw new Error("未找到项目招标文件（请确认附件已转存完成）");
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
      content: `已从 ${parsed.fileName}（${parsed.kind.toUpperCase()}，${Math.round(parsed.text.length / 100) / 10} 万字）定位到评分办法章节${section.matched ? `（命中「${section.matched}」）` : "（基于启发式定位）"}。\n\n正在调用大模型抽取评分项…\n\n`,
    });

    emit("step", { phase: "llm", message: "大模型抽取评分项…" });
    const items = await extractScoreItemsWithLlm(section.text, record, emit, requestHeaders);
    if (!items.length) {
      throw new Error("未能从招标文件中抽取到评分项");
    }
    emit("delta", {
      content: `\n\n抽取完成：共 **${items.length}** 项评分点。正在匹配截图知识库…\n\n`,
    });

    emit("step", { phase: "match", message: "匹配截图知识库…" });
    const matched = await matchExamplesForItems(supabase, items);

    const version = await nextVersion(supabase, recordId);

    // 清理旧评分项并写入新评分项
    await supabase.from("bidding_score_items").delete().eq("record_id", recordId);

    const rows = items.map((it, idx) => {
      const m = matched[idx];
      return {
        record_id: recordId,
        item_no: it.itemNo ?? idx + 1,
        title: it.title,
        requirement: it.requirement ?? null,
        score_value: it.scoreValue ?? null,
        category: it.category ?? null,
        order_index: idx,
        match_status: m ? "matched" : "pending",
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
          school: r.matched_example.school,
          projectName: r.matched_example.project_name,
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

// ============== LLM 抽取 ==============

async function extractScoreItemsWithLlm(
  sectionText: string,
  record: BiddingScreenshot,
  emit: ProgressEmit,
  requestHeaders?: Headers,
): Promise<RawScoreItem[]> {
  const prompt = [
    `项目名称：${record.projectName}`,
    `学校：${record.projectSchool}`,
    "",
    "以下是从招标文件中定位到的评分办法章节原文。请抽取所有评分项，以严格 JSON 数组返回（不要任何额外解释、不要 Markdown 代码块）。",
    "",
    "输出 JSON Schema：",
    `[
  {
    "itemNo": number,
    "title": string,
    "requirement": string,
    "scoreValue": number | null,
    "category": string
  }
]`,
    "",
    "规则：",
    "1. itemNo 从1递增；title 简短（≤30字）；requirement 描述具体评分标准（≤120字）。",
    "2. category 取值：技术/商务/价格/服务/资质/其他。",
    "3. 只抽取明确评分项；忽略说明段、目录、页眉页脚。",
    "4. 严格 JSON 数组，不要任何前导/后缀文字。",
    "",
    "-----原文开始-----",
    sectionText.slice(0, 60000),
    "-----原文结束-----",
  ].join("\n");

  const messages = buildMessages({ scenario: "bidding-score", prompt });
  const customHeaders = requestHeaders
    ? HeaderUtils.extractForwardHeaders(requestHeaders)
    : undefined;
  const client = new LLMClient(new Config({ timeout: 180_000 }), customHeaders);

  let buffer = "";
  for await (const part of client.stream(messages, {
    model: getModelForScenario("bidding-score"),
    temperature: 0.1,
  })) {
    const text = part?.content?.toString?.() ?? "";
    if (!text) continue;
    buffer += text;
    emit("delta", { content: text });
  }
  return parseScoreItemsJson(buffer);
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
