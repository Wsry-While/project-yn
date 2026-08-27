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
} from 'docx';
import { getAssetMeta, resolveAssetDownload } from './asset-access';
import type { ScreenshotGuide, GuideItem } from './screenshot-guide-service';

const IMAGE_MAX_BYTES = 8 * 1024 * 1024;
const IMAGE_WIDTH = 460;
const IMAGE_HEIGHT = 300;

function sanitizeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, '_').slice(0, 120);
}

async function fetchImageBuffer(
  assetId: string,
): Promise<{ data: Buffer; contentType: string } | null> {
  const meta = await getAssetMeta(assetId);
  if (!meta) return null;
  if (meta.status === 'failed' || meta.status === 'pending') return null;
  if (meta.byteSize && meta.byteSize > IMAGE_MAX_BYTES) return null;
  const resolved = await resolveAssetDownload(assetId);
  if (!resolved) return null;
  try {
    const r = await fetch(resolved.signedUrl, { redirect: 'follow' });
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length === 0 || buf.length > IMAGE_MAX_BYTES) return null;
    return { data: buf, contentType: meta.contentType || 'image/png' };
  } catch {
    return null;
  }
}

function detectImageType(contentType: string): 'png' | 'jpg' | 'gif' | 'bmp' {
  if (contentType.includes('jpeg') || contentType.includes('jpg')) return 'jpg';
  if (contentType.includes('gif')) return 'gif';
  if (contentType.includes('bmp')) return 'bmp';
  return 'png';
}

function cell(text: string, opts: { bold?: boolean; shading?: string; width?: number } = {}) {
  return new TableCell({
    width: opts.width ? { size: opts.width, type: WidthType.PERCENTAGE } : undefined,
    shading: opts.shading
      ? { type: ShadingType.CLEAR, color: 'auto', fill: opts.shading }
      : undefined,
    children: [new Paragraph({ children: [new TextRun({ text, bold: opts.bold, size: 20 })] })],
  });
}

function statusLabel(status: GuideItem['status']): string {
  if (status === 'ready') return '可截图';
  if (status === 'na') return '本项无';
  return '待补充';
}

/**
 * 生成「截图作业指导书」Word 文档。
 * 每个截图项一节：参数要求 → 作业说明 → 建议文件名 → 第一张历史参考图。
 * 标记为 na 的项仅列入附录清单，不占正文章节。
 */
export async function buildScreenshotGuideDocx(
  guide: ScreenshotGuide,
): Promise<{ buffer: Buffer; fileName: string }> {
  const children: (Paragraph | Table)[] = [];
  const generatedAt = new Date(guide.generatedAt);

  // 封面
  children.push(
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      alignment: AlignmentType.CENTER,
      spacing: { after: 120 },
      children: [new TextRun({ text: '截图作业指导书', bold: true, size: 40 })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: guide.projectName, size: 26, color: '444444' })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 240 },
      children: [
        new TextRun({
          text: `${guide.schoolName ? guide.schoolName + '  ·  ' : ''}生成时间：${generatedAt.toLocaleString('zh-CN')}`,
          size: 18,
          color: '888888',
        }),
      ],
    }),
  );

  // 概览表
  const activeItems = guide.items.filter((i) => i.status !== 'na');
  const overviewRows = [
    new TableRow({
      children: [
        cell('截图项总数', { bold: true, shading: 'F4F6FA', width: 25 }),
        cell(String(activeItems.length), { width: 25 }),
        cell('必截项', { bold: true, shading: 'F4F6FA', width: 25 }),
        cell(String(guide.totalScreenshots), { width: 25 }),
      ],
    }),
    new TableRow({
      children: [
        cell('已匹配参考图', { bold: true, shading: 'F4F6FA' }),
        cell(String(guide.matchedCount)),
        cell('待补充/无参考', { bold: true, shading: 'F4F6FA' }),
        cell(String(guide.unmatchedCount)),
      ],
    }),
  ];
  children.push(
    new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun('一、概览')] }),
    new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: overviewRows }),
    new Paragraph({ children: [] }),
  );

  // 截图项清单（表格）
  children.push(
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      children: [new TextRun('二、截图项清单')],
    }),
  );
  const listRows = [
    new TableRow({
      children: [
        cell('序号', { bold: true, shading: 'F4F6FA', width: 8 }),
        cell('参数/功能点', { bold: true, shading: 'F4F6FA', width: 42 }),
        cell('分值', { bold: true, shading: 'F4F6FA', width: 10 }),
        cell('参考图', { bold: true, shading: 'F4F6FA', width: 12 }),
        cell('状态', { bold: true, shading: 'F4F6FA', width: 14 }),
        cell('建议文件名', { bold: true, shading: 'F4F6FA', width: 14 }),
      ],
    }),
    ...guide.items.map((item) =>
      new TableRow({
        children: [
          cell(String(item.seq), { width: 8 }),
          cell(item.title, { width: 42 }),
          cell(item.score != null ? String(item.score) : '-', { width: 10 }),
          cell(item.references.length > 0 ? `${item.references.length} 张` : '无', { width: 12 }),
          cell(statusLabel(item.status), { width: 14 }),
          cell(item.suggestedFileName, { width: 14 }),
        ],
      }),
    ),
  ];
  children.push(
    new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: listRows }),
    new Paragraph({ children: [new PageBreak()] }),
  );

  // 逐项作业说明
  children.push(
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      children: [new TextRun('三、逐项作业说明')],
    }),
  );

  for (const item of activeItems) {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_3,
        spacing: { before: 240, after: 80 },
        children: [
          new TextRun({
            text: `${String(item.seq).padStart(2, '0')}. ${item.title}`,
            bold: true,
            size: 26,
          }),
        ],
      }),
    );

    const metaBits: string[] = [];
    if (item.systemModule) metaBits.push(`模块：${item.systemModule}`);
    if (item.score != null) metaBits.push(`分值：${item.score}`);
    metaBits.push(`类型：${item.mustCapture ? '重点参数（必截）' : '一般参数'}`);
    metaBits.push(`状态：${statusLabel(item.status)}`);
    children.push(
      new Paragraph({
        children: [new TextRun({ text: metaBits.join('   '), size: 18, color: '888888' })],
      }),
    );

    if (item.requirement && item.requirement !== item.title) {
      children.push(
        new Paragraph({
          spacing: { before: 80 },
          children: [
            new TextRun({ text: '招标要求：', bold: true, size: 20 }),
            new TextRun({ text: item.requirement, size: 20 }),
          ],
        }),
      );
    }

    if (item.instruction) {
      const lines = item.instruction.split('\n');
      for (const line of lines) {
        children.push(
          new Paragraph({
            children: [new TextRun({ text: line, size: 21 })],
          }),
        );
      }
    }

    children.push(
      new Paragraph({
        spacing: { before: 60 },
        children: [
          new TextRun({ text: '建议文件名：', bold: true, size: 19, color: '555555' }),
          new TextRun({ text: item.suggestedFileName, size: 19, font: 'Consolas' }),
        ],
      }),
    );

    // 第一张参考图（其余参考图仅在界面查看，Word 不重复贴）
    const firstRef = item.references[0];
    if (firstRef) {
      const img = await fetchImageBuffer(firstRef.assetId);
      if (img) {
        try {
          children.push(
            new Paragraph({
              spacing: { before: 80 },
              children: [
                new ImageRun({
                  data: img.data,
                  transformation: { width: IMAGE_WIDTH, height: IMAGE_HEIGHT },
                  type: detectImageType(img.contentType),
                  altText: {
                    title: item.title,
                    description: firstRef.visionNote || item.title,
                    name: item.title,
                  },
                }),
              ],
            }),
          );
          if (firstRef.visionNote) {
            children.push(
              new Paragraph({
                children: [
                  new TextRun({
                    text: `参考图识别要点：${firstRef.visionNote}`,
                    size: 18,
                    italics: true,
                    color: '666666',
                  }),
                ],
              }),
            );
          }
        } catch {
          children.push(
            new Paragraph({
              children: [new TextRun({ text: '[参考图读取失败]', color: 'CC0000' })],
            }),
          );
        }
      } else {
        children.push(
          new Paragraph({
            children: [
              new TextRun({
                text: '[参考图附件尚未就绪，请在系统中查看]',
                color: '999999',
                italics: true,
              }),
            ],
          }),
        );
      }
    } else {
      children.push(
        new Paragraph({
          shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'FFF7E6' },
          border: {
            top: { style: BorderStyle.SINGLE, size: 6, color: 'FFD591' },
            bottom: { style: BorderStyle.SINGLE, size: 6, color: 'FFD591' },
            left: { style: BorderStyle.SINGLE, size: 6, color: 'FFD591' },
            right: { style: BorderStyle.SINGLE, size: 6, color: 'FFD591' },
          },
          children: [
            new TextRun({
              text: '⚠ 暂无历史参考图，请按作业说明进入系统自行截取，并确认画面完整、关键参数清晰可读。',
              color: 'D46B08',
            }),
          ],
        }),
      );
    }
  }

  const doc = new Document({
    creator: '项目中心',
    title: `截图作业指导书 - ${guide.projectName}`,
    description: '基于招投标评分项与截图知识库生成',
    sections: [{ children }],
  });

  const buffer = await Packer.toBuffer(doc);
  const fileName = sanitizeFilename(`截图作业指导书_${guide.projectName}.docx`);
  return { buffer, fileName };
}
