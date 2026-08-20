import { Suspense } from 'react';

import { WeeklyReportView } from '@/components/weekly-report-view';

export const metadata = { title: 'AI 周报 · 项目中心' };

export default function WeeklyReportPage() {
  return (
    <Suspense fallback={null}>
      <WeeklyReportView />
    </Suspense>
  );
}
