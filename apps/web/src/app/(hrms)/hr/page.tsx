import type { Metadata } from 'next';
import { HrDashboard } from '@/components/hrms/dashboard';

export const metadata: Metadata = { title: 'HR dashboard' };

export default function HrHomePage() {
  return <HrDashboard />;
}
