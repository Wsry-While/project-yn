/**
 * 文档解析层：把已转存的 PDF / Word 附件转成纯文本，供 LLM 抽取信息。
 *
 * - PDF 使用 pdf-parse
 * - docx 使用 mammoth
 * - 老版 .doc 使用 word-extractor（纯 JS，无需系统依赖）
 * - 超长文本自动截断，避免灌入模型时 token 爆炸
 */
import WordExtractor from 'word-extractor';
import { resolveAssetDownload } from '../asset-access';

export type ParseKind = 'pdf' | 'docx' | 'doc' | 'unsupported';

export interface ParsedDocument {
  kind: ParseKind;
  text: string;
  truncated: boolean;
  /** 原始字节数，用于成本/上限判断。 */
  byteSize: number;
  fileName: string;
}

const MAX_TEXT_CHARS = 120_000;

function inferKind(fileName: string): ParseKind {
  const name = fileName.toLowerCase();
  if (name.endsWith('.pdf')) return 'pdf';
  if (name.endsWith('.docx')) return 'docx';
  if (name.endsWith('.doc')) return 'doc';
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
  } else if (kind === 'doc') {
    // 老版 .doc（OLE 复合文档），word-extractor 纯 JS 实现，无需系统依赖
    const extractor = new WordExtractor();
    const doc = await extractor.extract(buffer);
    fullText = [doc.getBody(), doc.getFootnotes(), doc.getHeaders(), doc.getEndnotes()]
      .filter(Boolean)
      .join('\n');
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
 * 通用"第X章 标题"章节切片器（基于 52 份真实招标文件学习，见 analyze-tender-structure.ts）。
 * 目录条目形如"第五章 采购需求\t24"（制表符+页码）需跳过；正文标题独占一行。
 * 返回每个匹配章节的完整区间，调用方按强信号打分选最合适的一段。
 */
function sliceChaptersByTitle(
  text: string,
  titleRe: RegExp,
): Array<{ start: number; end: number; slice: string; title: string }> {
  const results: Array<{ start: number; end: number; slice: string; title: string }> = [];
  const boundaryRe = /(?:^|[\r\n])\s*第[一二三四五六七八九十百0-9]+章[\s　][^\n]{0,50}/g;
  const boundaries: number[] = [];
  let bm: RegExpExecArray | null;
  while ((bm = boundaryRe.exec(text)) !== null) {
    const off = bm[0].length - bm[0].trimStart().length;
    boundaries.push(bm.index + off);
  }

  let m: RegExpExecArray | null;
  while ((m = titleRe.exec(text)) !== null) {
    const off = m[0].length - m[0].trimStart().length;
    const start = m.index + off;
    const titleLine = text.slice(start, start + 80);
    if (/\t\s*\d{1,3}\s*[\r\n]/.test(titleLine)) continue;
    const before = text.slice(Math.max(0, start - 30), start);
    if (/[：:。\u201c"'《]/.test(before.slice(-1))) continue;

    const nextBoundary = boundaries.find((p) => p > start + 10);
    const end = nextBoundary ?? text.length;
    const slice = text.slice(start, end);
    if (slice.trim().length > 200) {
      results.push({ start, end, slice, title: titleLine.split(/[\r\n]/)[0].trim() });
    }
  }
  return results;
}

/**
 * 从招标文件全文中定位"采购需求/项目需求/技术要求"章节（阶段二输入）。
 * 真实数据：18/43 为"第五章 采购需求"，其余散布第三~七章，标题变体含
 * 采购需求/项目需求/采购内容及要求/服务内容及要求/采购需求及技术要求/技术要求/技术指标。
 */
export function extractRequirementsSection(text: string): string | null {
  if (!text) return null;

  const titleRe =
    /(?:^|[\r\n])\s*第[一二三四五六七八九十百0-9]+章[\s　][^\n]{0,30}?(?:采购需求|项目需求|采购内容|服务内容|采购要求|参数要求|技术要求|技术指标|招标内容)/g;
  const candidates = sliceChaptersByTitle(text, titleRe);

  if (candidates.length > 0) {
    const strongSignals =
      /技术要求一览表|技术参数表|技术规格|功能要求|功能模块|系统要求|参数要求|▲|★|●/;
    const scored = candidates
      .map((c) => ({
        ...c,
        score:
          (strongSignals.test(c.slice) ? 100 : 0) +
          (c.slice.match(/▲|★|●/g)?.length ?? 0) * 5 +
          c.slice.length / 1000,
      }))
      .sort((a, b) => b.score - a.score);
    return scored[0].slice.slice(0, 60000);
  }

  const standaloneRe =
    /(?:^|[\r\n])\s{0,6}(采购需求及技术要求|采购需求一览表|技术指标|参数要求)[\s　]*[\r\n]/;
  const sm = text.match(standaloneRe);
  if (sm && sm.index != null) {
    const start = sm.index + sm[0].length - sm[0].trimStart().length;
    const slice = text.slice(start, start + 45000);
    if (slice.trim().length > 800) return slice;
  }

  const tableIdx = text.search(/技术要求一览表|技术参数表|技术规格一览表/);
  if (tableIdx >= 0) {
    const back = Math.max(0, tableIdx - 2000);
    return text.slice(back, back + 45000);
  }
  return null;
}

/**
 * 在长文档中定位"评标办法/评审办法/磋商方法"章节（阶段一输入）。
 * 基于 52 份真实招标文件学习：
 * - 评分章节分布在第三~七章，标题为 评标方法/评审办法/评审方法/磋商方法/评标办法/评审标准/磋商程序和方法
 * - 强锚点：综合评分法、分值构成与评分标准、技术部分评分、商务部分评分、详细评审、评分因素、满分
 * 策略：先按"第X章"标题切出完整章节并按评分信号打分；无章节标题时退化为强关键词片段。
 * 找不到时返回原文（已截断），matched=false 供上层判断。
 */
export function extractScoringSection(text: string): { text: string; matched: boolean } {
  // 评分章节信号：出现越多越可能是评分办法正文章节
  const scoreSignals =
    /综合评分法|分值构成|评分标准|评分因素|技术部分评分|商务部分评分|价格部分评分|详细评审|评标办法前附表|评审办法前附表|评分细则|评分表|满分\s*\d+\s*分|扣分/;

  // 1) 优先：按"第X章 + 评分类标题"切出完整章节
  const titleRe =
    /(?:^|[\r\n])\s*第[一二三四五六七八九十百0-9]+章[\s　][^\n]{0,40}?(?:评标方法|评标办法|评审办法|评审方法|评审标准|磋商方法|磋商程序|资格审查、评标办法|评分)/g;
  const chapters = sliceChaptersByTitle(text, titleRe);
  if (chapters.length > 0) {
    const scored = chapters
      .map((c) => {
        const sigMatches = c.slice.match(
          /综合评分法|分值构成|评分因素|技术部分|商务部分|价格部分|详细评审|评分细则|评分表|满分|扣分|得分/g,
        );
        return {
          ...c,
          score: (sigMatches?.length ?? 0) * 10 + c.slice.length / 2000,
        };
      })
      .sort((a, b) => b.score - a.score);
    const best = scored[0];
    // 至少要有一个评分信号，否则可能切到了错误章节
    if (scoreSignals.test(best.slice) || best.score >= 10) {
      return { text: best.slice.slice(0, 60000), matched: true };
    }
  }

  // 2) 无标准章节标题时：从强关键词起点截取到下一个"第X章"边界
  const strongKeywords = [
    '综合评分法',
    '分值构成与评分标准',
    '技术部分评分',
    '商务部分评分',
    '价格部分评分',
    '详细评审',
    '评分因素',
    '评分细则',
    '评标办法',
    '评审办法',
    '磋商方法',
  ];
  for (const kw of strongKeywords) {
    const idx = text.indexOf(kw);
    if (idx >= 0) {
      const slice = text.slice(idx, idx + 30000);
      if (slice.trim().length > 500 && scoreSignals.test(slice)) {
        return { text: slice, matched: true };
      }
    }
  }

  // 3) 弱兜底："评分标准"需附近有评分表特征，避免误命中功能描述（如"AI自动评分"）
  const candidate = text.match(/评分标准[\s\S]{0,12000}/);
  if (candidate && candidate[0].trim().length > 200) {
    const snippet = candidate[0];
    const hasScoreTable =
      /满分\s*\d+\s*分/.test(snippet) ||
      /得分\s*\d/.test(snippet) ||
      /评分因素/.test(snippet) ||
      /技术部分/.test(snippet) ||
      /商务部分/.test(snippet) ||
      /扣分/.test(snippet);
    if (hasScoreTable) return { text: snippet, matched: true };
  }

  return { text, matched: false };
}
