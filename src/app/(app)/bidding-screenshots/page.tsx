import type { Metadata } from 'next';
import { BiddingScreenshotsView } from '@/components/bidding-screenshots-view';

export const metadata: Metadata = {
  title: '招投标截图',
};

export default function BiddingScreenshotsPage() {
  return <BiddingScreenshotsView />;
}
