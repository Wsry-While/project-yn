import {
  Document,
  Packer,
  Paragraph,
  HeadingLevel,
  TextRun,
  Table,
  TableRow,
  TableCell,
  WidthType,
  AlignmentType,
  BorderStyle,
  ShadingType,
  ImageRun,
  PageBreak,
} from "docx";
import { getAdminSupabase } from "./api-utils";
import { getAssetMeta, resolveAssetDownload } from "./asset-access";
import type { BiddingFollowupTask, BiddingScoreItem, BiddingScreenshot } from "./types";

const IMAGE_MAX_BYTES = 8 * 1024 * 1024;

export interface DocumentPayload {
  record: BiddingScreenshot;
  items: BiddingScoreItem[];
  tasks: BiddingFollowupTask[];
  generatedAt: Date;
  generatedByName: string | null;
}

function sanitizeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, "_").slice(0, 120);
}

async function fetchImageBuffer(assetId: string): Promise<{ data: Buffer; contentType: string } | null> {
  const meta = await getAssetMeta(assetId);
  if (!meta) return null;
  if (meta.status === "failed" || meta.status === "pending") return null;
  if (meta.byteSize && meta.byteSize > IMAGE_MAX_BYTES) return null;
  const resolved = await resolveAssetDownload(assetId);
  if (!resolved) return null;
  try {
    const r = await fetch(resolved.signedUrl, { redirect: "follow" });
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length === 0 || buf.length > IMAGE_MAX_BYTES) return null;
    return { data: buf, contentType: meta.contentType || "image/png" };
  } catch {
    return null;
  }
}

function detectImageType(contentType: string): "png" | "jpg" | "gif" | "bmp" {
  if (contentType.includes("jpeg") || contentType.includes("jpg")) return "jpg";
  if (contentType.includes("gif")) return "gif";
  if (contentType.includes("bmp")) return "bmp";
  return "png";
}

function cell(text: string, opts: { bold?: boolean; shading?: string; width?: number } = {}) {
  return new TableCell({
    width: opts.width ? { size: opts.width, type: WidthType.PERCENTAGE } : undefined,
    shading: opts.shading ? { type: ShadingType.CLEAR, color: "auto", fill: opts.shading } : undefined,
    children: [
      new Paragraph({
        children: [new TextRun({ text, bold: opts.bold, size: 20 })],
      }),
    ],
  });
}

export async function buildDocx(payload: DocumentPayload): Promise<{ buffer: Buffer; fileName: string }> {
  const { record, items, tasks, generatedAt, generatedByName } = payload;
  const children: (Paragraph | Table)[] = [];

  children.push(
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: "招投标截图交付文档", bold: true, size: 36 })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({ text: record.projectName, size: 24, color: "444444" }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({
          text: `生成时间：${generatedAt.toLocaleString("zh-CN")}${generatedByName ? `  ·  ${generatedByName}` : ""}`,
          size: 18,
          color: "888888",
        }),
      ],
    }),
    new Paragraph({ children: [] }),
  );

  // 项目信息表
  children.push(
    new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("一、项目信息")] }),
  );
  const infoRows: Array<[string, string]> = [
    ["项目名称", record.projectName],
    ["所属学校", record.projectSchool || "-"],
    ["二级单位", record.projectSecondaryUnit || "-"],
    ["销售经理", record.salesManager || "-"],
    ["项目经理", record.assignedProjectManager || "-"],
    ["提交日期", record.submissionDate || "-"],
    ["要求交付日期", record.dueDeliveryDate || "-"],
    ["项目类别", Array.isArray(record.projectCategory) ? record.projectCategory.join("、") : record.projectCategory || "-"],
    ["截图需求", record.screenshotRequirement || "-"],
  ];
  children.push(
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: infoRows.map(
        ([k, v]) =>
          new TableRow({
            children: [
              cell(k, { bold: true, shading: "F4F6FA", width: 22 }),
              cell(v || "-", { width: 78 }),
            ],
          }),
      ),
    }),
  );

  // 评分项 + 截图
  children.push(
    new Paragraph({ children: [new PageBreak()] }),
    new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("二、评分项与交付截图")] }),
    new Paragraph({
      children: [
        new TextRun({
          text: `共 ${items.length} 项，已匹配 ${items.filter((i) => i.matchStatus === "matched" || i.matchStatus === "uploaded").length} 项，待补充 ${items.filter((i) => i.matchStatus === "pending" || i.matchStatus === "task_created").length} 项。`,
          size: 20,
          color: "666666",
        }),
      ],
    }),
  );

  for (let idx = 0; idx < items.length; idx++) {
    const item = items[idx];
    const isPending = item.matchStatus === "pending" || item.matchStatus === "task_created";
    const typeTag =
      item.itemType === "key"
        ? "【▲ 重点参数】"
        : item.itemType === "demo"
          ? "【演示】"
          : item.itemType === "document"
            ? "【文档】"
            : "";
    const methodTag =
      item.deliveryMethod === "demo"
        ? "［现场演示］"
        : item.deliveryMethod === "document"
          ? "［方案文档］"
          : item.deliveryMethod === "screenshot"
            ? "［产品截图］"
            : "";
    const typeColor =
      item.itemType === "key"
        ? "C0392B"
        : item.itemType === "demo"
          ? "1677FF"
          : "666666";
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_3,
        children: [
          new TextRun({ text: `${idx + 1}. ${item.title}`, bold: true }),
          ...(typeTag
            ? [new TextRun({ text: `  ${typeTag}`, color: typeColor, bold: true })]
            : []),
          ...(methodTag ? [new TextRun({ text: ` ${methodTag}`, color: "888888" })] : []),
          ...(item.scoreValue != null
            ? [
                new TextRun({
                  text:
                    item.itemType === "key" || item.itemType === "general"
                      ? `  (扣 ${item.scoreValue} 分/条)`
                      : `  (${item.scoreValue} 分)`,
                  color: "1677FF",
                }),
              ]
            : []),
          ...(isPending ? [new TextRun({ text: "  【待补充】", color: "D46B08", bold: true })] : []),
          ...(item.matchStatus === "na" ? [new TextRun({ text: "  【不适用】", color: "999999" })] : []),
        ],
      }),
    );
    if (item.requirement) {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: item.requirement, size: 20 })],
        }),
      );
    }

    const assetId = item.deliveryAssetId || item.matchedAssetId;
    if (assetId) {
      const img = await fetchImageBuffer(assetId);
      if (img) {
        try {
          children.push(
            new Paragraph({
              children: [
                new ImageRun({
                  data: img.data,
                  transformation: { width: 480, height: 300 },
                  type: detectImageType(img.contentType),
                  altText: { title: item.title, description: item.title, name: item.title },
                }),
              ],
            }),
          );
        } catch {
          children.push(new Paragraph({ children: [new TextRun({ text: "[截图读取失败]", color: "CC0000" })] }));
        }
      } else {
        children.push(
          new Paragraph({
            children: [new TextRun({ text: "[截图附件尚未就绪，请在系统中重新获取或上传]", color: "999999", italics: true })],
          }),
        );
      }
    } else if (isPending) {
      children.push(
        new Paragraph({
          shading: { type: ShadingType.CLEAR, color: "auto", fill: "FFF7E6" },
          border: {
            top: { style: BorderStyle.SINGLE, size: 6, color: "FFD591" },
            bottom: { style: BorderStyle.SINGLE, size: 6, color: "FFD591" },
            left: { style: BorderStyle.SINGLE, size: 6, color: "FFD591" },
            right: { style: BorderStyle.SINGLE, size: 6, color: "FFD591" },
          },
          children: [new TextRun({ text: "⚠ 此评分项暂未匹配到历史截图，请 PM 在系统中补充或创建督办任务。", color: "D46B08" })],
        }),
      );
    }

    if (item.deliveryNote) {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: `备注：${item.deliveryNote}`, size: 18, color: "666666", italics: true })],
        }),
      );
    }
  }

  // 督办任务
  if (tasks.length > 0) {
    children.push(
      new Paragraph({ children: [new PageBreak()] }),
      new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("三、督办任务清单")] }),
    );
    const taskRows = [
      new TableRow({
        children: [
          cell("任务", { bold: true, shading: "F4F6FA", width: 40 }),
          cell("负责人", { bold: true, shading: "F4F6FA", width: 20 }),
          cell("优先级", { bold: true, shading: "F4F6FA", width: 12 }),
          cell("状态", { bold: true, shading: "F4F6FA", width: 14 }),
          cell("截止日期", { bold: true, shading: "F4F6FA", width: 14 }),
        ],
      }),
      ...tasks.map(
        (t) =>
          new TableRow({
            children: [
              cell(t.title, { width: 40 }),
              cell(t.externalAssigneeName || "内部团队", { width: 20 }),
              cell(t.priority.toUpperCase(), { width: 12 }),
              cell(statusLabel(t.status), { width: 14 }),
              cell(t.dueDate ? t.dueDate.slice(0, 10) : "-", { width: 14 }),
            ],
          }),
      ),
    ];
    children.push(
      new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: taskRows }),
    );
  }

  const doc = new Document({
    creator: "项目中心",
    title: `${record.projectName} - 招投标截图交付文档`,
    description: "招投标截图交付文档",
    sections: [{ children }],
  });

  const buffer = await Packer.toBuffer(doc);
  const fileName = `${sanitizeFilename(record.projectName)}_截图交付文档_v${generatedAt.getTime()}.docx`;
  return { buffer, fileName };
}

function statusLabel(s: string): string {
  switch (s) {
    case "todo":
      return "待处理";
    case "in_progress":
      return "进行中";
    case "done":
      return "已完成";
    case "cancelled":
      return "已取消";
    default:
      return s;
  }
}

/**
 * PDF 导出：走「HTML 渲染 + 浏览器打印」的方案在服务端不可用。
 * 当前阶段使用简化的 PDFKit 直接输出文本版 PDF（保证交付完整性）。
 * 富文本截图将以占位提示呈现，用户可下载 docx 版本查看完整截图。
 */
export async function buildPdf(_payload: DocumentPayload): Promise<{ buffer: Buffer; fileName: string }> {
  // 动态导入 pdfkit，避免在不支持的环境中启动失败
  const PDFDocument = (await import("pdfkit")).default;
  const doc = new PDFDocument({ size: "A4", margin: 50, bufferPages: true, autoFirstPage: true });

  // 尝试注册中文字体（如果 assets 中存在），否则使用默认字体（中文可能显示为方块）
  // 生产环境应打包一个中文字体到 assets 目录，例如 NotoSansSC-Regular.ttf
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = await import("fs");
    const candidates = [
      process.env.PDF_CJK_FONT_PATH,
      "assets/fonts/NotoSansSC-Regular.ttf",
      "assets/fonts/SourceHanSansSC-Regular.otf",
    ].filter(Boolean) as string[];
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        doc.font(p);
        break;
      }
    }
  } catch {
    // ignore
  }

  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) =>
    doc.on("end", () => resolve(Buffer.concat(chunks))),
  );

  const { record, items, tasks, generatedAt, generatedByName } = _payload;
  doc.fontSize(20).text("招投标截图交付文档", { align: "center" });
  doc.moveDown(0.3);
  doc.fontSize(12).fillColor("#444").text(record.projectName, { align: "center" });
  doc.fontSize(9).fillColor("#888").text(
    `生成时间：${generatedAt.toLocaleString("zh-CN")}${generatedByName ? "  ·  " + generatedByName : ""}`,
    { align: "center" },
  );
  doc.moveDown();
  doc.fillColor("#000");

  doc.fontSize(14).text("一、项目信息");
  doc.moveDown(0.3);
  doc.fontSize(10);
  const info: Array<[string, string]> = [
    ["所属学校", record.projectSchool || "-"],
    ["二级单位", record.projectSecondaryUnit || "-"],
    ["销售经理", record.salesManager || "-"],
    ["项目经理", record.assignedProjectManager || "-"],
    ["提交日期", record.submissionDate || "-"],
    ["要求交付日期", record.dueDeliveryDate || "-"],
  ];
  for (const [k, v] of info) doc.text(`${k}：${v}`);
  doc.moveDown();

  doc.fontSize(14).text("二、评分项与交付截图");
  doc.moveDown(0.3);
  doc.fontSize(10).fillColor("#666").text(
    `共 ${items.length} 项；已匹配 ${items.filter((i) => i.matchStatus === "matched" || i.matchStatus === "uploaded").length} 项；待补充 ${items.filter((i) => i.matchStatus === "pending" || i.matchStatus === "task_created").length} 项。截图请查看 docx 版本。`,
  );
  doc.moveDown(0.3);
  doc.fillColor("#000");
  doc.fontSize(10);
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const isPending = item.matchStatus === "pending" || item.matchStatus === "task_created";
    const typeTag =
      item.itemType === "key"
        ? "[重点]"
        : item.itemType === "demo"
          ? "[演示]"
          : item.itemType === "document"
            ? "[文档]"
            : "";
    const methodTag =
      item.deliveryMethod === "demo"
        ? "〔现场演示〕"
        : item.deliveryMethod === "document"
          ? "〔方案文档〕"
          : item.deliveryMethod === "screenshot"
            ? "〔截图〕"
            : "";
    const scoreText =
      item.scoreValue != null
        ? item.itemType === "key" || item.itemType === "general"
          ? `(扣${item.scoreValue}分/条)`
          : `(${item.scoreValue}分)`
        : "";
    doc.text(
      `${i + 1}. ${item.title} ${typeTag}${methodTag}${scoreText}${isPending ? "  [待补充]" : ""}${item.matchStatus === "na" ? "  [不适用]" : ""}`,
    );
    if (item.requirement) {
      doc.fillColor("#444").fontSize(9).text(item.requirement.slice(0, 300), { indent: 12 });
      doc.fillColor("#000").fontSize(10);
    }
    if (item.deliveryNote) {
      doc.fillColor("#888").fontSize(9).text(`备注：${item.deliveryNote}`, { indent: 12 });
      doc.fillColor("#000").fontSize(10);
    }
    doc.moveDown(0.2);
  }

  if (tasks.length) {
    doc.addPage();
    doc.fontSize(14).text("三、督办任务清单");
    doc.moveDown(0.3);
    doc.fontSize(10);
    for (const t of tasks) {
      doc.text(
        `• [${statusLabel(t.status)}] ${t.title} —— ${t.externalAssigneeName || "内部团队"}${t.dueDate ? `（截止 ${t.dueDate.slice(0, 10)}）` : ""}`,
      );
    }
  }

  doc.end();
  const buffer = await done;
  const fileName = `${sanitizeFilename(record.projectName)}_截图交付文档_v${generatedAt.getTime()}.pdf`;
  return { buffer, fileName };
}

/**
 * 上传生成的文档到 bidding-attachments bucket 并写 external_file_assets，返回 assetId
 */
export async function uploadGeneratedDocument(
  buffer: Buffer,
  fileName: string,
  contentType: string,
): Promise<string> {
  const supabase = getAdminSupabase();
  const bucket = process.env.STORAGE_BUCKET || "bidding-attachments";
  const storageKey = `generated/${Date.now()}-${fileName.replace(/[^\w.\-]+/g, "_")}`;
  const { error: uploadErr } = await supabase.storage
    .from(bucket)
    .upload(storageKey, new Blob([new Uint8Array(buffer)], { type: contentType }), {
      contentType,
      upsert: false,
    });
  if (uploadErr) throw new Error(`文档上传失败: ${uploadErr.message}`);

  const { data, error: insertErr } = await supabase
    .from("external_file_assets")
    .insert({
      source: "generated",
      object_id: storageKey,
      file_name: fileName,
      suffix: fileName.split(".").pop() || null,
      content_type: contentType,
      byte_size: buffer.length,
      status: "stored",
      bucket,
      storage_key: storageKey,
      stored_url: null,
      error_message: null,
      retry_count: 0,
    } as never)
    .select("id")
    .single();
  if (insertErr) throw new Error(`文档元数据写入失败: ${insertErr.message}`);
  return (data as { id: string }).id;
}
