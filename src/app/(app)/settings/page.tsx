import type { Metadata } from 'next';
import { SettingsView } from '@/components/settings-view';

export const metadata: Metadata = {
  title: '项目设置',
};

export default function SettingsPage() {
  return <SettingsView />;
}
