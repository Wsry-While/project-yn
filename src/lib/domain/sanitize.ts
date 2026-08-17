/**
 * 服务端/客户端通用的最小 HTML sanitize。
 * 超星 richtext 字段是后台编辑产出的富文本，保留常用排版标签，剔除脚本/事件/iframe 等危险内容。
 */

const ALLOWED_TAGS = new Set([
  'p',
  'br',
  'b',
  'strong',
  'i',
  'em',
  'u',
  's',
  'strike',
  'blockquote',
  'ul',
  'ol',
  'li',
  'span',
  'div',
  'a',
  'img',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'th',
  'td',
  'code',
  'pre',
  'sub',
  'sup',
]);

const ALLOWED_ATTRS = new Set(['href', 'src', 'alt', 'title', 'target', 'rel', 'class', 'style']);
const URL_SAFE = /^(https?:|mailto:|tel:|\/|#)/i;

function attrValueAllowed(name: string, value: string): boolean {
  if (name === 'style') {
    // 仅保留白名单样式，剔除 expression / url() 等
    return !/expression|url\s*\(|javascript:|vbscript:|behavior:/i.test(value);
  }
  if (name === 'href' || name === 'src') {
    return URL_SAFE.test(value.trim());
  }
  return true;
}

function stripHtmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>(\r?\n)?/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr|table)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export interface SanitizedRichText {
  html: string | null;
  text: string | null;
}

export function sanitizeRichText(input: {
  html?: string | null;
  text?: string | null;
}): SanitizedRichText {
  const rawHtml = typeof input.html === 'string' ? input.html : '';
  const rawText = typeof input.text === 'string' ? input.text : '';
  if (!rawHtml && !rawText) return { html: null, text: null };

  if (typeof window === 'undefined') {
    // Node 环境：使用轻量正则清洗，不依赖 DOMParser
    const cleaned = rawHtml
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<(script|style|iframe|object|embed|form|input|button|link|meta|base)[^>]*>[\s\S]*?<\/\1>/gi, '')
      .replace(/<(script|style|iframe|object|embed|form|input|button|link|meta|base)[^>]*\/?>/gi, '')
      .replace(/\s+on[a-z]+\s*=\s*("[\s\S]*?"|'[\s\S]*?'|[^\s>]+)/gi, '')
      .replace(/\s+(href|src)\s*=\s*("\s*javascript:[\s\S]*?"|'\s*javascript:[\s\S]*?'|javascript:[^\s>]+)/gi, '');
    const text = (rawText || stripHtmlToText(cleaned)).trim();
    return { html: cleaned.trim() || null, text: text || null };
  }

  const doc = new DOMParser().parseFromString(rawHtml || rawText, 'text/html');
  const walk = (root: Node): void => {
    const toRemove: Node[] = [];
    root.childNodes.forEach((node) => {
      if (node.nodeType === Node.COMMENT_NODE) {
        toRemove.push(node);
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) {
        walk(node);
        return;
      }
      const el = node as Element;
      const tag = el.tagName.toLowerCase();
      if (!ALLOWED_TAGS.has(tag)) {
        // 保留内部文本/内联内容，但移除标签本身
        const parent = el.parentNode;
        if (parent) {
          while (el.firstChild) parent.insertBefore(el.firstChild, el);
          toRemove.push(el);
        }
        return;
      }
      for (const attr of Array.from(el.attributes)) {
        const name = attr.name.toLowerCase();
        if (name.startsWith('on') || !ALLOWED_ATTRS.has(name) || !attrValueAllowed(name, attr.value)) {
          el.removeAttribute(attr.name);
        }
      }
      if (tag === 'a') {
        el.setAttribute('rel', 'noopener noreferrer nofollow');
        if (el.getAttribute('target')) el.setAttribute('target', '_blank');
      }
      walk(el);
    });
    toRemove.forEach((n) => n.parentNode?.removeChild(n));
  };
  walk(doc.body);
  const html = doc.body.innerHTML.trim();
  const text = (rawText || doc.body.textContent || '').trim();
  return { html: html || null, text: text || null };
}
