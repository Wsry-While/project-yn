import { Suspense } from 'react';

import { RiskCenterView } from '@/components/risk-center-view';

export const metadata = { title: '风险预警 · 项目中心' };

export default function RiskCenterPage() {
  return (
    <Suspense fallback={null}>
      <RiskCenterView />
    </Suspense>
  );
}
