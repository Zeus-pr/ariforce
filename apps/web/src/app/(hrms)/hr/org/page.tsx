import type { Metadata } from 'next';
import { OrgChart } from '@/components/hrms/org-chart';

export const metadata: Metadata = { title: 'Organizational chart' };

export default function HrOrgPage() {
  return <OrgChart />;
}
