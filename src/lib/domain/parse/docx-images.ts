/**
 * 从 docx 交付文档中抽取内嵌图片。
 *
 * 真实交付场景里，销售把多张截图贴在一个 Word 文档里（「XX截图项.docx」），
 * 并非独立图片附件。本模块用 mammoth 解析 docx：
 *  1. 通过 convertImage 拦截每一张内嵌图，读取 buffer + contentType；
 *  2. 用占位符 `⟦IMG_n⟧` 替换 <img>，拿到保留图片位置的 HTML；
 *  3. 以图片占位符为切点，回溯它前面最近的「标题/加粗段落/非空短段落」作为
 *     这张图对应的参数名/功能点提示（contextHint），喂给视觉模型提升准确率。
 */
import mammoth from 'mammoth';

export interface ExtractedDocxImage {
  /** 文档内序号，从 0 开始 */
  index: number;
  buffer: Buffer;
  contentType: string; // image/png | image/jpeg ...
  /** 推断的文件后缀 */
  ext: 'png' | 'jpg' | 'jpeg' | 'gif' | 'bmp' | 'webp';
  /** 这张图前面最近的标题/参数文字（可能为空） */
  contextHint: string;
  /** 图片在文档中出现顺序的稳定 key：recordId + 内容 hash 前 16 位 */
  contentHash: string;
}

const PLACEHOLDER = (n: number) => `\u27E6IMG_${n}\u27E7`;

/**
 * 抽取 docx 中全部内嵌图片。
 * @param arrayBuffer docx 文件二进制
 * @param recordContext 记录级上下文（项目名等），仅用于兜底提示
 */
export async function extractImagesFromDocx(
  arrayBuffer: ArrayBuffer,
  recordContext?: { projectName?: string | null },
): Promise<ExtractedDocxImage[]> {
  const collected: Array<{ buffer: Buffer; contentType: string }> = [];
  let counter = 0;

  // 第一步：用占位符替换图片，收集 buffer；同时拿到保留位置的 HTML。
  // mammoth 的 openZip 认 buffer 字段（Node Buffer），不认 arrayBuffer。
  const result = await mammoth.convertToHtml(
    { buffer: Buffer.from(arrayBuffer) },
    {
      convertImage: mammoth.images.imgElement(async (image) => {
        const buffer = await image.readAsBuffer();
        const contentType = (image.contentType || 'image/png').toLowerCase();
        const idx = counter++;
        if (buffer && buffer.length > 0) {
          collected.push({ buffer, contentType });
        } else {
          // 占位，保持序号对齐
          collected.push({ buffer: Buffer.alloc(0), contentType });
        }
        // 返回带占位符的 src，占位符会出现在 HTML 中图片的位置
        return { src: PLACEHOLDER(idx) };
      }),
    },
  );

  const html = result.value || '';
  const images: ExtractedDocxImage[] = [];

  for (let i = 0; i < collected.length; i++) {
    const c = collected[i];
    if (!c.buffer || c.buffer.length === 0) continue;
    const hint = extractContextBeforePlaceholder(html, i);
    images.push({
      index: i,
      buffer: c.buffer,
      contentType: c.contentType,
      ext: extFromContentType(c.contentType),
      contextHint: hint || recordContext?.projectName?.trim() || '',
      contentHash: hashBuffer(c.buffer),
    });
  }

  return images;
}

function extFromContentType(ct: string): ExtractedDocxImage['ext'] {
  if (ct.includes('jpeg') || ct.includes('jpg')) return 'jpeg';
  if (ct.includes('png')) return 'png';
  if (ct.includes('gif')) return 'gif';
  if (ct.includes('bmp')) return 'bmp';
  if (ct.includes('webp')) return 'webp';
  return 'png';
}

/**
 * 在 HTML 中找到第 n 个图片占位符，取它之前最近的有意义文本作为上下文。
 * 优先级：标题(h1-h6/strong)文本 > 最近非空短段落(<=60字) > 最近任意非空文本片段。
 */
function extractContextBeforePlaceholder(html: string, n: number): string {
  const marker = PLACEHOLDER(n);
  const pos = html.indexOf(marker);
  if (pos < 0) return '';
  const before = html.slice(0, pos);

  // 去掉所有标签但保留段落/换行边界
  const text = before
    .replace(/<img\b[^>]*>?/gi, ' ') // 图片标签（含可能未正常闭合的）
    .replace(/⟦IMG_\d+⟧/g, ' ') // 残留占位符
    .replace(/<\/(h[1-6]|p|div|li|tr|strong|b)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"');

  const lines = text
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l.length > 0 && !/<|src=/i.test(l)); // 跳过残留标签碎片

  if (lines.length === 0) return '';

  // 从后往前找：优先短行（像标题/参数名，<= 80 字）
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (line.length <= 80 && looksLikeTitle(line)) return line.slice(0, 160);
  }
  // 兜底：最后一条非空文本（截断）
  return lines[lines.length - 1].slice(0, 160);
}

/** 粗略判断一行是否像参数标题/功能点名 */
function looksLikeTitle(line: string): boolean {
  // 纯数字编号开头：1. / 1、 / （1）/ ①
  if (/^[（(]?[0-9一二三四五六七八九十]+[）)、.．]/.test(line)) return true;
  // 含「支持/提供/具备/可/能够/实现/含」等功能描述动词且不长
  if (/(支持|提供|具备|能够|实现|拥有|含|包括|可)/.test(line)) return true;
  // 以 ▲★● 开头
  if (/^[▲★●＊*]/.test(line)) return true;
  return false;
}

/** 轻量内容 hash（FNV-1a），用于同 docx 内/跨 docx 去重，非加密用途 */
function hashBuffer(buf: Buffer): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < buf.length; i++) {
    h ^= buf[i];
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}
