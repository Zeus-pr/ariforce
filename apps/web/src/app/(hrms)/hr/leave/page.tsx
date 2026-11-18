import type { Metadata } from 'next';
import { HrLeave } from '@/components/hrms/leave';

export const metadata: Metadata = { title: 'Leave' };

export default function HrLeavePage() {
  return <HrLeave />;
}
