import { Suspense } from 'react';

import { DataAlignView } from '@/components/data-align-view';

export const metadata = { title: '数据对齐 · 项目中心' };

export default function DataAlignPage() {
  return (
    <Suspense fallback={null}>
      <DataAlignView />
    </Suspense>
  );
}
