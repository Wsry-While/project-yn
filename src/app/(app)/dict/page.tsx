import { Suspense } from 'react';

import { DictAdminView } from '@/components/dict-admin-view';

export const metadata = { title: '字典管理 · 项目中心' };

export default function DictAdminPage() {
  return (
    <Suspense fallback={null}>
      <DictAdminView />
    </Suspense>
  );
}
