'use client';
import { ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function Forbidden({ message }: { message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-md border border-border bg-card py-20 text-center shadow-card">
      <ShieldAlert className="h-12 w-12 text-status-danger" />
      <h2 className="mt-3 text-lg font-semibold">403 · 无权访问</h2>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">
        {message ?? '你没有访问该页面的权限，如需开通请联系超级管理员。'}
      </p>
      <Button className="mt-4" onClick={() => window.history.back()}>
        返回上一页
      </Button>
    </div>
  );
}
