import { redirect } from 'next/navigation';

export const metadata = { title: 'AI 周报 · 项目中心' };

export default function ReportIndexPage() {
  redirect('/reports/weekly');
}
