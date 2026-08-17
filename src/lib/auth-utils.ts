import { NextRequest } from 'next/server';

/**
 * 获取请求的真实公网 origin（协议+域名+端口）
 *
 * 优先级：
 * 1. 环境变量 COZE_PROJECT_DOMAIN_DEFAULT（最可靠，平台注入的公网域名）
 * 2. X-Forwarded-Proto + X-Forwarded-Host / Host 请求头
 * 3. request.nextUrl.origin（最后兜底）
 */
export function getRealOrigin(request: NextRequest): string {
  // 优先使用平台注入的公网域名
  const domainEnv = process.env.COZE_PROJECT_DOMAIN_DEFAULT;
  if (domainEnv) {
    // 环境变量可能带或不带协议前缀
    return domainEnv.startsWith('http') ? domainEnv : `https://${domainEnv}`;
  }

  const forwardedProto = request.headers.get('x-forwarded-proto');
  const forwardedHost = request.headers.get('x-forwarded-host');
  const host = request.headers.get('host');

  const protocol = forwardedProto || (request.nextUrl.protocol === 'https:' ? 'https' : 'http');
  const realHost = forwardedHost || host || request.nextUrl.host;

  return `${protocol}://${realHost}`;
}

/**
 * 只允许站内相对跳转，避免登录回调被用作开放重定向。
 */
export function normalizeSafeRedirectPath(value: string | null): string | null {
  if (!value || !value.startsWith('/') || value.startsWith('//')) {
    return null;
  }

  try {
    const parsed = new URL(value, 'https://template.local');
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
}

export function decodeCookieValue(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
