'use client';

import { LogIn } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { ChaoxingLoginOptions } from '@/lib/chaoxing-client';

type LoginButtonProps = ChaoxingLoginOptions;

/** 未配置名称时 name 会回落成 FID 本身，此时不必再括号重复一遍。 */
function formatInstitution({ fid, name }: { fid: string; name: string }): string {
  return name === fid ? fid : `${name}（${fid}）`;
}

/**
 * 登录入口有两种形态，由 CHAOXING_FIDS 是否配了机构名称决定：
 * - institutions 非空：先在下拉框里选机构，登录严格限定在所选机构下
 * - institutions 为空：只有一个按钮，机构由回调静默轮询确定
 */
export default function LoginButton({ configured, institutions }: LoginButtonProps) {
  const [fid, setFid] = useState('');
  const [isPending, setIsPending] = useState(false);

  const handleLogin = () => {
    setIsPending(true);
    // 没有下拉框时不带 fid，服务端会用第一个 FID 起头再轮询其余机构。
    window.location.assign(fid ? `/api/auth/chaoxing?fid=${encodeURIComponent(fid)}` : '/api/auth/chaoxing');
  };

  if (!configured) {
    return (
      <div className="flex flex-col items-center gap-2">
        <Button disabled>
          <LogIn className="size-4" />
          使用超星账号登录
        </Button>
        <p className="text-sm text-muted-foreground">超星登录未配置，登录不可用</p>
      </div>
    );
  }

  if (institutions.length === 0) {
    return (
      <Button disabled={isPending} onClick={handleLogin}>
        <LogIn className="size-4" />
        {isPending ? '正在跳转...' : '使用超星账号登录'}
      </Button>
    );
  }

  return (
    <div className="flex w-72 flex-col gap-3">
      <Select value={fid} onValueChange={setFid} disabled={isPending}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder="请选择所属机构" />
        </SelectTrigger>
        <SelectContent>
          {institutions.map((institution) => (
            <SelectItem key={institution.fid} value={institution.fid}>
              {formatInstitution(institution)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button disabled={isPending || !fid} onClick={handleLogin}>
        <LogIn className="size-4" />
        {isPending ? '正在跳转...' : '使用超星账号登录'}
      </Button>
    </div>
  );
}
