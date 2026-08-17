import type { Metadata } from 'next';
import { TripsView } from '@/components/trips-view';

export const metadata: Metadata = {
  title: '项目外出',
};

export default function TripsPage() {
  return <TripsView />;
}
