"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FileText,
  FileDown,
  Sparkles,
  CheckCircle2,
  Circle,
  Loader2,
  AlertTriangle,
  Plus,
  X,
  UserPlus,
  ExternalLink,
  Upload,
  Image as ImageIcon,
} from "lucide-react";
import { apiFetch, apiFetchSSE } from "@/lib/web/api-client";
import { showToast } from "@/lib/web/toast-store";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Modal } from "@/components/modal";
import type {
  BiddingFollowupPriority,
  BiddingFollowupTask,
  BiddingScoreItem,
  BiddingScreenshot,
} from "@/lib/domain/types";

interface DocumentBundle {
  id: string;
  version: number;
  status: "generating" | "ready" | "failed";
  matchedCount: number;
  pendingCount: number;
  taskCount: number;
  docxAssetId: string | null;
  pdfAssetId: string | null;
  generatedByName: string | null;
  createdAt: string;
}

interface PanelProps {
  record: BiddingScreenshot;
}

interface TeamMember {
  id: string;
  name: string;
}

const PRIORITY_LABEL: Record<BiddingFollowupPriority, string> = {
  p0: "P0 紧急",
  p1: "P1 高",
  p2: "P2 中",
  p3: "P3 低",
};

const PRIORITY_TONE: Record<BiddingFollowupPriority, "danger" | "warning" | "brand" | "neutral"> = {
  p0: "danger",
  p1: "warning",
  p2: "brand",
  p3: "neutral",
};

export function BiddingDocumentPanel({ record }: PanelProps) {
  const [bundle, setBundle] = useState<DocumentBundle | null>(null);
  const [items, setItems] = useState<BiddingScoreItem[]>([]);
  const [tasks, setTasks] = useState<BiddingFollowupTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [streamLog, setStreamLog] = useState<string>("");
  const [taskDialog, setTaskDialog] = useState<BiddingScoreItem | null>(null);

  const fetchDoc = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<{
        document:
          | (DocumentBundle & { scoreItems: BiddingScoreItem[]; followupTasks: BiddingFollowupTask[] })
          | null;
      }>(`/api/bidding-screenshots/${record.id}/document`);
      const d = res.document;
      if (d) {
        setBundle({
          id: d.id,
          version: d.version,
          status: d.status,
          matchedCount: d.matchedCount,
          pendingCount: d.pendingCount,
          taskCount: d.taskCount,
          docxAssetId: d.docxAssetId,
          pdfAssetId: d.pdfAssetId,
          generatedByName: d.generatedByName,
          createdAt: d.createdAt,
        });
        setItems(d.scoreItems);
        setTasks(d.followupTasks);
      } else {
        setBundle(null);
        setItems([]);
        setTasks([]);
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : "加载文档失败", { kind: "error" });
    } finally {
      setLoading(false);
    }
  }, [record.id]);

  useEffect(() => {
    fetchDoc();
  }, [fetchDoc]);

  const total = items.length;
  const matchedCount = items.filter(
    (i) => i.matchStatus === "matched" || i.matchStatus === "uploaded",
  ).length;
  const pendingCount = items.filter(
    (i) => i.matchStatus === "pending" || i.matchStatus === "task_created",
  ).length;
  const taskCreatedCount = items.filter((i) => i.matchStatus === "task_created").length;
  const progressPct = total === 0 ? 0 : Math.round((matchedCount / total) * 100);

  const generate = async () => {
    if (generating) return;
    setGenerating(true);
    setStreamLog("");
    let acc = "";
    apiFetchSSE(
      `/api/bidding-screenshots/${record.id}/generate-document`,
      {},
      {
        onMeta: (meta) => {
          const m = meta as { message?: string; phase?: string; fileName?: string };
          if (m.fileName) {
            setStreamLog((prev) => `${prev}\n▸ 解析文件：${m.fileName}`);
          } else if (m.message) {
            setStreamLog((prev) => `${prev}\n▸ ${m.message}`);
          }
        },
        onDelta: (text) => {
          acc += text;
          setStreamLog((prev) => `${prev}${text}`);
        },
        onDone: () => {
          setGenerating(false);
          fetchDoc();
        },
        onError: (err) => {
          setGenerating(false);
          showToast(err.message || "生成失败", { kind: "error" });
        },
      },
    );
  };

  const download = (format: "docx" | "pdf") => {
    const a = window.document.createElement("a");
    a.href = `/api/bidding-screenshots/${record.id}/document/download?format=${format}`;
    a.download = "";
    window.document.body.appendChild(a);
    a.click();
    window.document.body.removeChild(a);
  };

  const reopen = async (item: BiddingScoreItem) => {
    try {
      await apiFetch(`/api/bidding-screenshots/${record.id}/score-items/${item.id}`, {
        method: "PATCH",
        body: JSON.stringify({ matchStatus: "pending" }),
      });
      await fetchDoc();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "操作失败", { kind: "error" });
    }
  };

  const updateTaskStatus = async (
    task: BiddingFollowupTask,
    status: BiddingFollowupTask["status"],
  ) => {
    try {
      await apiFetch(`/api/bidding-screenshots/followup-tasks/${task.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      await fetchDoc();
      showToast("任务状态已更新", { kind: "success" });
    } catch (err) {
      showToast(err instanceof Error ? err.message : "操作失败", { kind: "error" });
    }
  };

  return (
    <section className="rounded-lg border border-border bg-card/50">
      <header className="flex items-center justify-between gap-3 border-b border-border p-4">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-brand" />
          <h3 className="text-sm font-semibold">交付文档</h3>
          {bundle && (
            <span className="text-xs text-muted-foreground">
              v{bundle.version} · {matchedCount}/{total} 已完成
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {bundle && total > 0 && (
            <>
              <Button
                size="xs"
                variant="outline"
                className="h-7 rounded-sm"
                onClick={() => download("docx")}
              >
                <FileDown className="h-3 w-3" />
                Word
              </Button>
              <Button
                size="xs"
                variant="outline"
                className="h-7 rounded-sm"
                onClick={() => download("pdf")}
              >
                <FileDown className="h-3 w-3" />
                PDF
              </Button>
            </>
          )}
          <Button
            size="xs"
            className="h-7 rounded-sm bg-brand text-white hover:bg-brand/90"
            onClick={generate}
            disabled={generating}
          >
            {generating ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Sparkles className="h-3 w-3" />
            )}
            {bundle ? "重新生成" : "生成文档"}
          </Button>
        </div>
      </header>

      <div className="p-4">
        {loading && !bundle && (
          <div className="py-10 text-center text-xs text-muted-foreground">加载中…</div>
        )}

        {!loading && !bundle && !generating && (
          <div className="rounded-md border border-dashed border-border bg-muted/30 p-6 text-center">
            <Sparkles className="mx-auto mb-2 h-5 w-5 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              点击「生成文档」，系统将解析招标文件，自动抽取评分项并匹配截图知识库。
            </p>
            {!record.projectBiddingFile && (
              <p className="mt-2 text-xs text-status-danger">
                该记录尚未上传招标文件，无法生成。请等待第三方附件转存或联系管理员。
              </p>
            )}
          </div>
        )}

        {generating && (
          <div className="mb-3 rounded-md border border-brand/30 bg-brand/5 p-3">
            <div className="mb-2 flex items-center gap-2 text-xs text-brand">
              <Loader2 className="h-3 w-3 animate-spin" />
              正在生成，请稍候…
            </div>
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap text-xs leading-5 text-muted-foreground">
              {streamLog || "正在连接大模型…"}
            </pre>
          </div>
        )}

        {bundle && total > 0 && (
          <>
            <div className="mb-4">
              <div className="mb-1 flex items-center justify-between text-xs">
                <span className="text-muted-foreground">
                  已匹配 {matchedCount} · 待补充 {pendingCount} · 督办 {taskCreatedCount}
                </span>
                <span className="font-medium text-foreground">{progressPct}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-brand transition-all"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            </div>

            <ScoreItemList
              items={items}
              onReopen={reopen}
              onCreateTask={(it) => setTaskDialog(it)}
              onTaskStatus={updateTaskStatus}
              onUploaded={() => fetchDoc()}
            />

            {tasks.length > 0 && (
              <div className="mt-5">
                <h4 className="mb-2 text-xs font-semibold text-muted-foreground">
                  督办任务（{tasks.length}）
                </h4>
                <div className="space-y-2">
                  {tasks.map((t) => (
                    <FollowupTaskRow key={t.id} task={t} onStatus={updateTaskStatus} />
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <CreateTaskDialog
        recordId={record.id}
        item={taskDialog}
        onClose={() => setTaskDialog(null)}
        onCreated={() => {
          setTaskDialog(null);
          fetchDoc();
        }}
      />
    </section>
  );
}

function ScoreItemList({
  items,
  onReopen,
  onCreateTask,
  onTaskStatus,
  onUploaded,
}: {
  items: BiddingScoreItem[];
  onReopen: (it: BiddingScoreItem) => void;
  onCreateTask: (it: BiddingScoreItem) => void;
  onTaskStatus: (t: BiddingFollowupTask, s: BiddingFollowupTask["status"]) => void;
  onUploaded: (recordId: string, itemId: string) => void;
}) {
  const [filter, setFilter] = useState<"all" | "pending" | "matched" | "task">("all");
  const filtered = useMemo(() => {
    if (filter === "pending")
      return items.filter((i) => i.matchStatus === "pending" || i.matchStatus === "task_created");
    if (filter === "matched")
      return items.filter((i) => i.matchStatus === "matched" || i.matchStatus === "uploaded");
    if (filter === "task") return items.filter((i) => i.matchStatus === "task_created");
    return items;
  }, [items, filter]);

  return (
    <div>
      <div className="mb-2 flex items-center gap-2 text-xs">
        {(
          [
            { k: "all", label: `全部 ${items.length}` },
            {
              k: "pending",
              label: `待补充 ${items.filter((i) => i.matchStatus === "pending").length}`,
            },
            {
              k: "task",
              label: `督办中 ${items.filter((i) => i.matchStatus === "task_created").length}`,
            },
            {
              k: "matched",
              label: `已匹配 ${
                items.filter((i) => i.matchStatus === "matched" || i.matchStatus === "uploaded").length
              }`,
            },
          ] as const
        ).map((f) => (
          <button
            key={f.k}
            type="button"
            onClick={() => setFilter(f.k)}
            className={`rounded-sm px-2 py-0.5 ${
              filter === f.k
                ? "bg-brand/10 text-brand"
                : "text-muted-foreground hover:bg-muted"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        {filtered.map((it) => (
          <ScoreItemRow
            key={it.id}
            recordId={items[0]?.recordId ?? ""}
            item={it}
            index={items.indexOf(it) + 1}
            onReopen={onReopen}
            onCreateTask={onCreateTask}
            onTaskStatus={onTaskStatus}
            onUploaded={onUploaded}
          />
        ))}
      </div>
    </div>
  );
}

function ScoreItemRow({
  recordId,
  item,
  index,
  onReopen,
  onCreateTask,
  onTaskStatus,
  onUploaded,
}: {
  recordId: string;
  item: BiddingScoreItem;
  index: number;
  onReopen: (it: BiddingScoreItem) => void;
  onCreateTask: (it: BiddingScoreItem) => void;
  onTaskStatus: (t: BiddingFollowupTask, s: BiddingFollowupTask["status"]) => void;
  onUploaded: (recordId: string, itemId: string) => void;
}) {
  const isPending = item.matchStatus === "pending";
  const isTask = item.matchStatus === "task_created";
  const isMatched = item.matchStatus === "matched" || item.matchStatus === "uploaded";
  const isUploaded = item.matchStatus === "uploaded";
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const pickFile = () => fileInputRef.current?.click();

  const handleFile = async (file: File) => {
    if (file.size > 15 * 1024 * 1024) {
      showToast("截图不能超过 15 MB", { kind: "error" });
      return;
    }
    if (!/^image\/(png|jpe?g|gif|webp|bmp)$/i.test(file.type)) {
      showToast("仅支持 PNG/JPG/GIF/WEBP/BMP 图片", { kind: "error" });
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(
        `/api/bidding-screenshots/${recordId}/score-items/${item.id}/upload`,
        { method: "POST", body: fd, credentials: "same-origin" },
      );
      const json = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        error?: { message?: string };
      };
      if (!res.ok || !json.success) {
        throw new Error(json.error?.message || "上传失败");
      }
      showToast("截图已上传", { kind: "success" });
      onUploaded(recordId, item.id);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "上传失败", { kind: "error" });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <div
      className={`rounded-md border p-3 ${
        isPending
          ? "border-status-warning/40 bg-status-warning/5"
          : isTask
            ? "border-brand/40 bg-brand/5"
            : "border-border bg-card"
      }`}
    >
      <div className="flex items-start gap-2">
        <div className="mt-0.5 shrink-0">
          {isMatched ? (
            <CheckCircle2 className="h-4 w-4 text-status-success" />
          ) : isTask ? (
            <AlertTriangle className="h-4 w-4 text-brand" />
          ) : (
            <Circle className="h-4 w-4 text-status-warning" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">#{index}</span>
            <span className="text-sm font-medium">{item.title}</span>
            {item.itemType === "key" && (
              <Badge tone="danger" className="text-[10px]">
                ▲ 重点
              </Badge>
            )}
            {item.itemType === "demo" && (
              <Badge tone="brand" className="text-[10px]">
                演示
              </Badge>
            )}
            {item.deliveryMethod === "demo" && (
              <Badge tone="brand" className="text-[10px]">
                现场演示
              </Badge>
            )}
            {item.scoreValue != null && (
              <Badge tone="neutral" className="text-[10px]">
                {item.itemType === "key" || item.itemType === "general"
                  ? `扣 ${item.scoreValue} 分/条`
                  : `${item.scoreValue} 分`}
              </Badge>
            )}
            {item.category && (
              <Badge tone="neutral" className="text-[10px]">
                {item.category}
              </Badge>
            )}
            {isPending && <Badge tone="warning">待补充</Badge>}
            {isTask && <Badge tone="brand">督办中</Badge>}
          </div>
          {item.requirement && (
            <p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-muted-foreground">
              {item.requirement}
            </p>
          )}

          {isMatched && item.matchedExample && (
            <div className="mt-2 rounded border border-border bg-muted/30 p-2">
              <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <CheckCircle2 className="h-3 w-3 text-status-success" />
                {isUploaded ? "PM 已上传截图：" : "已匹配历史截图："}
                {isUploaded
                  ? item.deliveryNote || "手动上传"
                  : item.matchedExample.systemModule ||
                    item.matchedExample.description ||
                    "历史交付截图"}
                {!isUploaded && (item.matchedExample.source || item.matchedExample.tags?.length) && (
                  <span>· {item.matchedExample.source || item.matchedExample.tags?.join("、")}</span>
                )}
              </div>
              {(item.deliveryAssetId || item.matchedExample.assetId) && (
                <div className="mt-2 flex items-center gap-3">
                  <a
                    href={`/api/files/preview/${item.deliveryAssetId || item.matchedExample.assetId}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] text-brand hover:underline"
                  >
                    <ImageIcon className="h-3 w-3" />
                    {isUploaded ? "查看我上传的截图" : "查看截图"}
                  </a>
                  <button
                    type="button"
                    onClick={pickFile}
                    disabled={uploading}
                    className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-brand disabled:opacity-60"
                  >
                    {uploading ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Upload className="h-3 w-3" />
                    )}
                    {isUploaded ? "替换截图" : "用自己的截图替换"}
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/gif,image/webp,image/bmp"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void handleFile(f);
                    }}
                  />
                </div>
              )}
            </div>
          )}

          {isTask && item.followupTask && (
            <div className="mt-2 rounded border border-brand/30 bg-brand/5 p-2 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-medium text-brand">
                  督办任务：{item.followupTask.title}
                </span>
                <Select
                  value={item.followupTask.status}
                  onValueChange={(v: string) =>
                    onTaskStatus(item.followupTask!, v as BiddingFollowupTask["status"])
                  }
                >
                  <SelectTrigger size="sm" className="h-6 w-[90px] text-[11px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todo">待处理</SelectItem>
                    <SelectItem value="in_progress">进行中</SelectItem>
                    <SelectItem value="done">已完成</SelectItem>
                    <SelectItem value="cancelled">已取消</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="mt-1 text-muted-foreground">
                负责人：
                {item.followupTask.externalAssigneeName || "内部团队"}
                {item.followupTask.dueDate &&
                  ` · 截止 ${item.followupTask.dueDate.slice(0, 10)}`}
              </div>
            </div>
          )}

          <div className="mt-2 flex flex-wrap items-center gap-1">
            {isPending && (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/gif,image/webp,image/bmp"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void handleFile(f);
                  }}
                />
                <Button
                  size="xs"
                  variant="outline"
                  className="h-6 rounded-sm text-[11px]"
                  onClick={pickFile}
                  disabled={uploading}
                >
                  {uploading ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Upload className="h-3 w-3" />
                  )}
                  上传截图
                </Button>
                <Button
                  size="xs"
                  variant="outline"
                  className="h-6 rounded-sm text-[11px]"
                  onClick={() => onCreateTask(item)}
                >
                  <Plus className="h-3 w-3" />
                  创建督办任务
                </Button>
              </>
            )}
            {isTask && (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/gif,image/webp,image/bmp"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void handleFile(f);
                  }}
                />
                <Button
                  size="xs"
                  variant="outline"
                  className="h-6 rounded-sm text-[11px]"
                  onClick={pickFile}
                  disabled={uploading}
                >
                  {uploading ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Upload className="h-3 w-3" />
                  )}
                  直接补截图
                </Button>
              </>
            )}
            {isMatched && (
              <Button
                size="xs"
                variant="ghost"
                className="h-6 rounded-sm text-[11px] text-muted-foreground"
                onClick={() => onReopen(item)}
              >
                重置为待补充
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function FollowupTaskRow({
  task,
  onStatus,
}: {
  task: BiddingFollowupTask;
  onStatus: (t: BiddingFollowupTask, s: BiddingFollowupTask["status"]) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-card p-2">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Badge tone={PRIORITY_TONE[task.priority]} className="text-[10px]">
            {PRIORITY_LABEL[task.priority]}
          </Badge>
          <span className="truncate text-xs font-medium">{task.title}</span>
        </div>
        <div className="mt-0.5 text-[11px] text-muted-foreground">
          <UserPlus className="mr-1 inline h-3 w-3" />
          {task.externalAssigneeName
            ? `${task.externalAssigneeName}${task.externalAssigneeOrg ? ` · ${task.externalAssigneeOrg}` : ""}`
            : "内部团队"}
          {task.dueDate && ` · 截止 ${task.dueDate.slice(0, 10)}`}
        </div>
      </div>
      <Select
        value={task.status}
        onValueChange={(v: string) => onStatus(task, v as BiddingFollowupTask["status"])}
      >
        <SelectTrigger size="sm" className="h-7 w-[100px] text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="todo">待处理</SelectItem>
          <SelectItem value="in_progress">进行中</SelectItem>
          <SelectItem value="done">已完成</SelectItem>
          <SelectItem value="cancelled">已取消</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

function CreateTaskDialog({
  recordId,
  item,
  onClose,
  onCreated,
}: {
  recordId: string;
  item: BiddingScoreItem | null;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [assigneeType, setAssigneeType] = useState<"internal" | "external">("internal");
  const [assigneeId, setAssigneeId] = useState("");
  const [externalName, setExternalName] = useState("");
  const [externalContact, setExternalContact] = useState("");
  const [externalOrg, setExternalOrg] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<BiddingFollowupPriority>("p2");
  const [dueDate, setDueDate] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!item) return;
    setTitle(item.title ? `协助截图：${item.title}` : "");
    setDescription(item.requirement ?? "");
    setAssigneeId("");
    setExternalName("");
    setExternalContact("");
    setExternalOrg("");
    setPriority("p2");
    setDueDate("");
    setAssigneeType("internal");
    setTimeout(() => titleRef.current?.focus(), 80);
    apiFetch<{ members: TeamMember[] }>("/api/bidding-screenshots/team/options")
      .then((res) => setMembers(res.members))
      .catch(() => undefined);
  }, [item]);

  if (!item) return null;

  const submit = async () => {
    if (!title.trim()) {
      showToast("请填写任务标题", { kind: "error" });
      return;
    }
    if (assigneeType === "internal" && !assigneeId) {
      showToast("请选择内部负责人", { kind: "error" });
      return;
    }
    if (assigneeType === "external" && !externalName.trim()) {
      showToast("请填写外部负责人姓名", { kind: "error" });
      return;
    }
    setSubmitting(true);
    try {
      await apiFetch(`/api/bidding-screenshots/${recordId}/score-items/${item.id}/followup-task`, {
        method: "POST",
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || null,
          priority,
          assigneeId: assigneeType === "internal" ? assigneeId : null,
          externalAssigneeName: assigneeType === "external" ? externalName.trim() : null,
          externalAssigneeContact: assigneeType === "external" ? externalContact.trim() : null,
          externalAssigneeOrg: assigneeType === "external" ? externalOrg.trim() : null,
          dueDate: dueDate || null,
        }),
      });
      showToast("督办任务已创建", { kind: "success" });
      onCreated();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "创建失败", { kind: "error" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={!!item}
      onClose={onClose}
      title="创建督办任务"
      description="指派给内部团队或外部协作人，用于跟进无法直接截图的评分项"
      size="lg"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose} disabled={submitting}>
            <X className="h-3 w-3" />
            取消
          </Button>
          <Button
            size="sm"
            className="bg-brand text-white hover:bg-brand/90"
            onClick={submit}
            disabled={submitting}
          >
            {submitting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
            创建任务
          </Button>
        </div>
      }
    >
      <div className="max-h-[70vh] space-y-3 overflow-y-auto px-1 py-2">
        <div className="rounded-md bg-muted/40 p-2 text-xs text-muted-foreground">
          <div className="font-medium text-foreground">{item.title}</div>
          {item.requirement && <div className="mt-1 line-clamp-3">{item.requirement}</div>}
        </div>

        <div>
          <Label className="text-xs">任务标题</Label>
          <Input
            ref={titleRef}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="h-8 text-sm"
            placeholder="例如：协助导出 XX 系统模块截图"
          />
        </div>

        <div>
          <Label className="text-xs">任务描述</Label>
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="text-sm"
            placeholder="说明需要的截图范围、参数、参考链接等"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">优先级</Label>
            <Select value={priority} onValueChange={(v: string) => setPriority(v as BiddingFollowupPriority)}>
              <SelectTrigger size="sm" className="h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="p0">P0 紧急</SelectItem>
                <SelectItem value="p1">P1 高</SelectItem>
                <SelectItem value="p2">P2 中</SelectItem>
                <SelectItem value="p3">P3 低</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">截止日期</Label>
            <Input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="h-8 text-sm"
            />
          </div>
        </div>

        <div className="rounded-md border border-border p-3">
          <Label className="mb-2 block text-xs">指派给</Label>
          <div className="mb-3 flex gap-2">
            <button
              type="button"
              onClick={() => setAssigneeType("internal")}
              className={`flex-1 rounded-sm border px-3 py-1.5 text-xs ${
                assigneeType === "internal"
                  ? "border-brand bg-brand/5 text-brand"
                  : "border-border text-muted-foreground"
              }`}
            >
              内部团队成员
            </button>
            <button
              type="button"
              onClick={() => setAssigneeType("external")}
              className={`flex-1 rounded-sm border px-3 py-1.5 text-xs ${
                assigneeType === "external"
                  ? "border-brand bg-brand/5 text-brand"
                  : "border-border text-muted-foreground"
              }`}
            >
              外部协作人
            </button>
          </div>

          {assigneeType === "internal" ? (
            <Select value={assigneeId} onValueChange={setAssigneeId}>
              <SelectTrigger size="sm" className="h-8 w-full text-sm">
                <SelectValue placeholder="选择团队成员" />
              </SelectTrigger>
              <SelectContent>
                {members.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <div className="space-y-2">
              <Input
                value={externalName}
                onChange={(e) => setExternalName(e.target.value)}
                placeholder="姓名 *"
                className="h-8 text-sm"
              />
              <div className="grid grid-cols-2 gap-2">
                <Input
                  value={externalOrg}
                  onChange={(e) => setExternalOrg(e.target.value)}
                  placeholder="单位（选填）"
                  className="h-8 text-sm"
                />
                <Input
                  value={externalContact}
                  onChange={(e) => setExternalContact(e.target.value)}
                  placeholder="联系方式（选填）"
                  className="h-8 text-sm"
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
