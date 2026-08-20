import { Suspense } from 'react';

import { AnalyticsView } from '@/components/analytics-view';

export const metadata = { title: '多维分析 · 项目中心' };

export default function AnalyticsPage() {
  return (
    <Suspense fallback={null}>
      <AnalyticsView />
    </Suspense>
  );
}
