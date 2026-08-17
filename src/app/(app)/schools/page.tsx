import type { Metadata } from 'next';
import { SchoolsView } from '@/components/schools-view';

export const metadata: Metadata = {
  title: '学校档案',
};

export default function SchoolsPage() {
  return <SchoolsView />;
}
