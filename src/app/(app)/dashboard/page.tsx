import type { Metadata } from 'next';
import { DashboardView } from '@/components/dashboard-view';

export const metadata: Metadata = { title: '仪表盘' };

export default function DashboardPage() {
  return <DashboardView />;
}
