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
const IMAGE_MAX_WIDTH = 460;
const IMAGE_MAX_HEIGHT = 360;

function sanitizeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, '_').slice(0, 120);
}

/**
 * 读取 PNG/JPG 的像素宽高（直接解析文件头，不引第三方图片库）。
 * GIF/BMP 返回 null，由调用方退回默认尺寸。
 */
function readImageSize(data: Buffer, contentType: string): { width: number; height: number } | null {
  try {
    if (contentType.includes('png')) {
      // PNG: 8 字节签名后 IHDR，宽高在偏移 16/20（大端 4 字节）
      if (data.length >= 24 && data.toString('ascii', 12, 16) === 'IHDR') {
        return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
      }
    }
    if (contentType.includes('jpeg') || contentType.includes('jpg')) {
      // JPEG: 扫描 SOF 标记取宽高
      let offset = 2;
      while (offset + 9 < data.length) {
        if (data[offset] !== 0xff) {
          offset += 1;
          continue;
        }
        const marker = data[offset + 1];
        // SOF0..SOF15（除 DHT/C4、DAC/CC 外）
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          const height = data.readUInt16BE(offset + 5);
          const width = data.readUInt16BE(offset + 7);
          return { width, height };
        }
        const segLen = data.readUInt16BE(offset + 2);
        offset += 2 + segLen;
      }
    }
  } catch {
    // fallthrough
  }
  return null;
}

/** 按真实宽高比缩放，限制在最大宽高内（不拉伸变形） */
function fitImage(
  width: number | null,
  height: number | null,
): { width: number; height: number } {
  if (!width || !height || width <= 0 || height <= 0) {
    return { width: IMAGE_MAX_WIDTH, height: Math.round(IMAGE_MAX_WIDTH * 0.62) };
  }
  const ratio = Math.min(IMAGE_MAX_WIDTH / width, IMAGE_MAX_HEIGHT / height, 1);
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
  };
}

async function fetchImageBuffer(
  assetId: string,
): Promise<{ data: Buffer; contentType: string; width: number | null; height: number | null } | null> {
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
    const contentType = meta.contentType || 'image/png';
    const size = readImageSize(buf, contentType);
    return {
      data: buf,
      contentType,
      width: size?.width ?? null,
      height: size?.height ?? null,
    };
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

    // 参考图：一项参数可由多张截图共同响应（用户跨组勾选并排序），全部按序插入
    const refs = item.references ?? [];
    if (refs.length > 0) {
      for (let r = 0; r < refs.length; r++) {
        const ref = refs[r];
        const img = await fetchImageBuffer(ref.assetId);
        if (!img) {
          children.push(
            new Paragraph({
              spacing: { before: 80 },
              children: [
                new TextRun({
                  text: `[参考图 ${r + 1}/${refs.length} 附件尚未就绪，请在系统中查看]`,
                  color: '999999',
                  italics: true,
                  size: 18,
                }),
              ],
            }),
          );
          continue;
        }
        try {
          // 多张图加「图 N/总数」小标题，方便交付人员按顺序截取
          if (refs.length > 1) {
            children.push(
              new Paragraph({
                spacing: { before: 120 },
                children: [
                  new TextRun({ text: `参考图 ${r + 1}/${refs.length}`, bold: true, size: 19, color: '333333' }),
                ],
              }),
            );
          } else {
            children.push(new Paragraph({ spacing: { before: 80 }, children: [] }));
          }
          children.push(
            new Paragraph({
              children: [
                new ImageRun({
                  data: img.data,
                  transformation: fitImage(img.width, img.height),
                  type: detectImageType(img.contentType),
                  altText: {
                    title: item.title,
                    description: ref.visionNote || item.title,
                    name: item.title,
                  },
                }),
              ],
            }),
          );
          if (ref.visionNote) {
            children.push(
              new Paragraph({
                children: [
                  new TextRun({
                    text: `图注：${ref.visionNote}`,
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
              children: [new TextRun({ text: `[参考图 ${r + 1} 读取失败]`, color: 'CC0000' })],
            }),
          );
        }
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
