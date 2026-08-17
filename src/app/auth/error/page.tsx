import type { Metadata } from 'next';
import Link from 'next/link';
import { AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getChaoxingLoginOptions } from '@/lib/chaoxing-client';
import { normalizeLoginErrorReason, type LoginErrorReason } from '@/lib/login-error';

export const metadata: Metadata = {
  title: '登录失败',
  description: '超星登录未能完成',
};

const ERROR_COPY: Record<LoginErrorReason, { title: string; description: string }> = {
  institution_mismatch: {
    title: '账号无权登录本应用',
    description:
      '你的超星账号不属于本应用允许的任何机构，或这些机构未开通本应用。请联系管理员确认账号所在机构。',
  },
  oauth_failed: {
    title: '超星授权未完成',
    description: '超星没有返回有效的授权信息，授权码可能已过期或被重复使用。请返回登录页重试。',
  },
  session_failed: {
    title: '登录会话建立失败',
    description: '超星身份已验证通过，但创建本地登录会话时出错。请稍后重试，若持续失败请联系管理员。',
  },
  config_missing: {
    title: '登录服务未正确配置',
    description: '应用缺少超星登录所需的配置项，用户侧无法自行解决，请联系管理员。',
  },
};

/** 登录页有下拉框时，institution_mismatch 是"选错了"，用户自己就能补救。 */
const INSTITUTION_MISMATCH_WITH_CHOICE = {
  title: '无法在该机构下登录',
  description:
    '你的超星账号不属于所选机构，或该机构未开通本应用。请返回登录页换一个机构再试。',
};

function firstParam(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? '';
}

interface LoginErrorPageProps {
  searchParams: Promise<{ reason?: string | string[] }>;
}

export default async function LoginErrorPage({ searchParams }: LoginErrorPageProps) {
  const params = await searchParams;
  const reason = normalizeLoginErrorReason(firstParam(params.reason).trim());
  const canChooseInstitution = getChaoxingLoginOptions().institutions.length > 0;
  const copy =
    reason === 'institution_mismatch' && canChooseInstitution
      ? INSTITUTION_MISMATCH_WITH_CHOICE
      : ERROR_COPY[reason];

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4 text-foreground">
      <main className="flex w-full max-w-md flex-col items-center gap-5 rounded-xl border border-border bg-card p-6 text-center sm:p-8">
        <AlertCircle className="size-10 text-destructive" />
        <div className="flex flex-col gap-2">
          <h1 className="text-lg font-semibold text-card-foreground">{copy.title}</h1>
          <p className="text-sm leading-relaxed text-muted-foreground">{copy.description}</p>
        </div>
        <Button asChild className="w-full">
          <Link href="/">返回登录页</Link>
        </Button>
      </main>
    </div>
  );
}
