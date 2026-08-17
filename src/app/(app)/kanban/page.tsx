import type { Metadata } from 'next';
import { KanbanView } from '@/components/kanban-view';

export const metadata: Metadata = {
  title: '任务看板',
};

export default function KanbanPage() {
  return <KanbanView />;
}
