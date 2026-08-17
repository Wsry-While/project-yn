import type { Metadata } from 'next';
import { TeamView } from '@/components/team-view';

export const metadata: Metadata = {
  title: '团队管理',
};

export default function TeamPage() {
  return <TeamView />;
}
