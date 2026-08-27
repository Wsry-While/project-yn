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

async function downloadUrlBuffer(url: string, fileNameHint?: string): Promise<{ buffer: Buffer; fileName: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        // 超星 CDN 强制校验 Referer，缺失直接 403。
        Referer: 'https://office.chaoxing.com/',
      },
      signal: controller.signal,
      redirect: 'follow',
    });
    if (!res.ok) throw new Error(`下载招标文件失败: HTTP ${res.status}`);
    const cd = res.headers.get('content-disposition') || '';
    const nameMatch = cd.match(/filename\*?=(?:UTF-8'')?["']?([^;"']+)/i);
    const fileName =
      fileNameHint ||
      (nameMatch ? decodeURIComponent(nameMatch[1].trim()) : url.split('/').pop()?.split('?')[0] || '招标文档');
    const arrayBuffer = await res.arrayBuffer();
    return { buffer: Buffer.from(arrayBuffer), fileName };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 解析附件文本。会把文件下载到内存（通常招标文件 < 10MB），调用方应只对
 * stored/direct 状态、且大小合理的 asset 调用，避免大文件。
 */
export async function parseAssetDocument(assetId: string): Promise<ParsedDocument> {
  const { buffer, fileName } = await downloadAssetBuffer(assetId);
  return parseDocumentBuffer(buffer, fileName);
}

/**
 * 从超星/外部直链下载并解析文档（用于 storageStatus=direct 的招标文件，
 * 这类文件未转存到我方对象存储，只有临时直链）。
 *
 * 特别支持超星 OA 多文件下载页：形如
 *   https://office.chaoxing.com/front/open/data/export/multiple/download?t=...&f=...&fu=...&ii=...
 * 该 URL 直接 GET 会返回 HTML，需要改打 JSON 接口
 *   /data/export/multiple/download（同参数）拿到 formData，
 * 再取其中 alias=projectBiddingFile 的第一个文件 objectId，
 * 最后调用 /ananas/status/{objectId} 换取真实签名下载地址。
 */
export async function parseDocumentFromUrl(url: string, fileNameHint?: string): Promise<ParsedDocument> {
  // 1) 超星多文件下载页：/front/open/data/export/multiple/download?...
  const multi = resolveChaoxingMultiDownload(url);
  if (multi) {
    const first = await fetchChaoxingFirstFile(multi);
    if (first) {
      const signed = await getChaoxingSignedUrl(first.objectId);
      const { buffer, fileName } = await downloadUrlBuffer(signed, first.name || fileNameHint);
      return parseDocumentBuffer(buffer, fileName);
    }
  }
  // 2) 超星单文件下载页：/front/open/data/export/download?objectid=...&resid=...&suffix=...
  const single = resolveChaoxingSingleDownload(url);
  if (single) {
    const signed = await fetchChaoxingSingleSignedUrl(single);
    if (signed) {
      const { buffer, fileName } = await downloadUrlBuffer(signed, single.fileName || fileNameHint);
      return parseDocumentBuffer(buffer, fileName);
    }
  }
  const { buffer, fileName } = await downloadUrlBuffer(url, fileNameHint);
  return parseDocumentBuffer(buffer, fileName);
}

interface ChaoxingMultiParams {
  t: string;
  f: string;
  fu: string;
  ii?: string;
  ci?: string;
  gi?: string;
  gii?: string;
}

function resolveChaoxingMultiDownload(url: string): ChaoxingMultiParams | null {
  try {
    const u = new URL(url);
    if (!/(^|\.)chaoxing\.com$/i.test(u.hostname)) return null;
    if (!/\/data\/export\/multiple\/download|\/front\/open\/data\/export\/multiple\/download/.test(u.pathname)) {
      return null;
    }
    const t = u.searchParams.get('t');
    const f = u.searchParams.get('f');
    const fu = u.searchParams.get('fu');
    if (!t || !f || !fu) return null;
    return {
      t,
      f,
      fu,
      ii: u.searchParams.get('ii') || undefined,
      ci: u.searchParams.get('ci') || undefined,
      gi: u.searchParams.get('gi') || undefined,
      gii: u.searchParams.get('gii') || undefined,
    };
  } catch {
    return null;
  }
}

interface ChaoxingFileMeta {
  objectId: string;
  name?: string;
  suffix?: string;
  resid?: string;
}

async function fetchChaoxingFirstFile(params: ChaoxingMultiParams): Promise<ChaoxingFileMeta | null> {
  const qs = new URLSearchParams({ t: params.t, f: params.f, fu: params.fu });
  if (params.ii) qs.set('ii', params.ii);
  if (params.ci) qs.set('ci', params.ci);
  if (params.gi) qs.set('gi', params.gi);
  if (params.gii) qs.set('gii', params.gii);
  const endpoint = `https://office.chaoxing.com/data/export/multiple/download?${qs.toString()}`;
  const res = await fetch(endpoint, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
      Referer: 'https://office.chaoxing.com/front/open/data/export/multiple/download',
      Accept: 'application/json, text/plain, */*',
      'X-Requested-With': 'XMLHttpRequest',
    },
  });
  if (!res.ok) return null;
  const json = (await res.json()) as {
    data?: { formData?: string; formIdValueData?: string };
    success?: boolean;
  };
  if (!json?.data?.formData) return null;
  const formData = JSON.parse(json.data.formData) as Array<{
    alias?: string;
    fields?: Array<{ values?: ChaoxingFileMeta[] }>;
    compt?: string;
  }>;
  // 优先取招标文件别名；否则回退到第一个 fileupload 字段。
  const bidding = formData.find((x) => x.alias === 'projectBiddingFile' || x.alias === 'project_bidding_file');
  const target = bidding ?? formData.find((x) => Array.isArray(x.fields?.[0]?.values) && (x.fields?.[0]?.values?.[0] as { objectId?: string })?.objectId);
  const firstFile = target?.fields?.[0]?.values?.find((v) => v && v.objectId);
  return firstFile ?? null;
}

interface ChaoxingSingleParams {
  objectid: string;
  resid?: string;
  suffix?: string;
  fileName?: string;
}

function resolveChaoxingSingleDownload(url: string): ChaoxingSingleParams | null {
  try {
    const u = new URL(url);
    if (!/(^|\.)chaoxing\.com$/i.test(u.hostname)) return null;
    if (!/\/(?:front\/open\/data\/export|data\/export)\/download$/i.test(u.pathname)) return null;
    // 注意：多文件路径 /multiple/download 不在此分支处理。
    const objectid = u.searchParams.get('objectid');
    if (!objectid) return null;
    return {
      objectid,
      resid: u.searchParams.get('resid') || undefined,
      suffix: u.searchParams.get('suffix') || undefined,
      fileName: u.searchParams.get('fileName') || undefined,
    };
  } catch {
    return null;
  }
}

async function fetchChaoxingSingleSignedUrl(params: ChaoxingSingleParams): Promise<string | null> {
  // type 与超星前端 filePreviewUtils.getType 对齐：docx/doc → 5 等，实际服务端只校验是否合法。
  const qs = new URLSearchParams({ objectid: params.objectid, type: '5' });
  if (params.resid) qs.set('resid', params.resid);
  const endpoint = `https://office.chaoxing.com/data/export/get/download/url?${qs.toString()}`;
  const res = await fetch(endpoint, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
      Referer: 'https://office.chaoxing.com/front/open/data/export/download',
      Accept: 'application/json, text/plain, */*',
      'X-Requested-With': 'XMLHttpRequest',
    },
  });
  if (!res.ok) return null;
  const json = (await res.json()) as { success?: boolean; data?: string };
  return json?.success && json.data ? json.data : null;
}

async function getChaoxingSignedUrl(objectId: string): Promise<string> {
  // 与 src/lib/domain/chaoxing/file-tool.ts 保持同一签名换取逻辑：
  // 先调 /ananas/status/{objectId} 拿带 at_/ak_/ad_ 的 download 地址。
  const statusUrl = `https://mooc1.chaoxing.com/ananas/status/${objectId}`;
  const res = await fetch(statusUrl, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
      Referer: 'https://office.chaoxing.com/',
    },
  });
  if (!res.ok) throw new Error(`超星文件状态接口失败: HTTP ${res.status}`);
  const data = (await res.json()) as { download?: string; durl?: string };
  const signed = data.download || data.durl;
  if (!signed) throw new Error('超星文件状态接口未返回下载地址');
  return signed;
}

async function parseDocumentBuffer(buffer: Buffer, fileName: string): Promise<ParsedDocument> {
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
 * 策略：
 * 1) 优先匹配评分表中才会出现的强信号词（如"评分因素"、"技术部分评分"、"商务部分评分"、"综合评分法"等）
 * 2) 其次匹配章节标题（"第四章 磋商方法"、"评标办法"、"评分细则"等）
 * 3) 最后才是宽泛的"评分标准"——这个词可能在功能描述中出现（如"AI自动评分"），作为兜底
 * 找不到时返回原文（已截断）。
 */
export function extractScoringSection(text: string): { text: string; matched: boolean } {
  // 强信号：评分表 / 评分办法章节才会出现的关键词，权重最高
  const strongPatterns: RegExp[] = [
    /评分因素[\s\S]{0,15000}/,
    /技术部分评分[\s\S]{0,15000}/,
    /商务部分评分[\s\S]{0,15000}/,
    /价格部分评分[\s\S]{0,15000}/,
    /综合评分法[\s\S]{0,15000}/,
    /评分细则[\s\S]{0,15000}/,
    /评分表[\s\S]{0,15000}/,
    /评标办法[\s\S]{0,15000}/,
    /评审办法[\s\S]{0,15000}/,
    /评审方法[\s\S]{0,15000}/,
    /磋商方法[\s\S]{0,15000}/,
  ];
  for (const re of strongPatterns) {
    const m = text.match(re);
    if (m && m[0].trim().length > 200) return { text: m[0], matched: true };
  }

  // 弱信号兜底：寻找"评分标准"，但需要附近还有得分/满分等评分表特征词，避免误匹配功能描述
  const candidate = text.match(/评分标准[\s\S]{0,15000}/);
  if (candidate && candidate[0].trim().length > 200) {
    const snippet = candidate[0];
    const hasScoreTable =
      /满分\s*\d+\s*分/.test(snippet) ||
      /得分\s*\d/.test(snippet) ||
      /评分因素/.test(snippet) ||
      /技术部分/.test(snippet) ||
      /商务部分/.test(snippet) ||
      /价格部分/.test(snippet) ||
      /扣分/.test(snippet);
    if (hasScoreTable) return { text: snippet, matched: true };
  }

  // 最后兜底：找包含"评分"且在表格上下文中的位置
  const tableCandidate = text.match(/序号[\s\S]{0,200}评分[\s\S]{0,15000}/);
  if (tableCandidate && tableCandidate[0].length > 500) {
    return { text: tableCandidate[0], matched: true };
  }

  return { text, matched: false };
}
