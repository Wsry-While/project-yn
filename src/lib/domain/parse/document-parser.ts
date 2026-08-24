/**
 * 文档解析层：把已转存的 PDF / Word 附件转成纯文本，供 LLM 抽取信息。
 *
 * - PDF 使用 pdf-parse
 * - docx 使用 mammoth
 * - 老版 .doc / 其他格式不支持纯文本解析，返回 unsupported
 * - 超长文本自动截断，避免灌入模型时 token 爆炸
 */
import { resolveAssetDownload } from '../asset-access';

export type ParseKind = 'pdf' | 'docx' | 'unsupported';

export interface ParsedDocument {
  kind: ParseKind;
  text: string;
  truncated: boolean;
  /** 原始字节数，用于成本/上限判断。 */
  byteSize: number;
  fileName: string;
}

const MAX_TEXT_CHARS = 60_000;

function inferKind(fileName: string): ParseKind {
  const name = fileName.toLowerCase();
  if (name.endsWith('.pdf')) return 'pdf';
  if (name.endsWith('.docx')) return 'docx';
  return 'unsupported';
}

async function downloadAssetBuffer(assetId: string): Promise<{ buffer: Buffer; fileName: string }> {
  const resolved = await resolveAssetDownload(assetId);
  if (!resolved) throw new Error('附件尚未转存完成或不可下载');
  // 超星直链/对象存储签名 URL 均为可直接 GET 的临时地址。
  const res = await fetch(resolved.signedUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 ProjectCenter-DocParser' },
  });
  if (!res.ok) throw new Error(`下载附件失败: HTTP ${res.status}`);
  const arrayBuffer = await res.arrayBuffer();
  return { buffer: Buffer.from(arrayBuffer), fileName: resolved.fileName };
}

/**
 * 解析附件文本。会把文件下载到内存（通常招标文件 < 10MB），调用方应只对
 * stored/direct 状态、且大小合理的 asset 调用，避免大文件。
 */
export async function parseAssetDocument(assetId: string): Promise<ParsedDocument> {
  const { buffer, fileName } = await downloadAssetBuffer(assetId);
  const kind = inferKind(fileName);

  if (kind === 'unsupported') {
    return { kind: 'unsupported', text: '', truncated: false, byteSize: buffer.length, fileName };
  }

  let fullText = '';
  if (kind === 'pdf') {
    // pdf-parse 在某些打包环境下会读取测试文件；动态 import 并用 `.default`/模块本体兼容。
    const mod: unknown = await import('pdf-parse');
    const pdfParse: (buf: Buffer) => Promise<{ text: string }> =
      typeof (mod as { default?: unknown }).default === 'function'
        ? ((mod as { default: (buf: Buffer) => Promise<{ text: string }> }).default)
        : (mod as (buf: Buffer) => Promise<{ text: string }>);
    const result = await pdfParse(buffer);
    fullText = result.text ?? '';
  } else if (kind === 'docx') {
    const mod: unknown = await import('mammoth');
    const mammoth = mod as { extractRawText: (input: { buffer: Buffer }) => Promise<{ value: string }> };
    const result = await mammoth.extractRawText({ buffer });
    fullText = result.value ?? '';
  }

  const truncated = fullText.length > MAX_TEXT_CHARS;
  return {
    kind,
    text: truncated ? fullText.slice(0, MAX_TEXT_CHARS) : fullText,
    truncated,
    byteSize: buffer.length,
    fileName,
  };
}

/**
 * 在长文档中定位"评标办法/评分标准"章节，只保留相关片段，减少无关 token。
 * 找不到时返回原文（已截断）。
 */
export function extractScoringSection(text: string): { text: string; matched: boolean } {
  const patterns = [
    /评标办法[\s\S]{0,12000}/,
    /评分标准[\s\S]{0,12000}/,
    /评分细则[\s\S]{0,12000}/,
    /评审办法[\s\S]{0,12000}/,
    /综合评分法[\s\S]{0,12000}/,
    /评分因素[\s\S]{0,12000}/,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m && m[0].trim().length > 30) return { text: m[0], matched: true };
  }
  return { text, matched: false };
}
