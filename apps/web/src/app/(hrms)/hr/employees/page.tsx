import type { Metadata } from 'next';
import { EmployeeList } from '@/components/hrms/employee-list';

export const metadata: Metadata = { title: 'People' };

export default function HrPeoplePage() {
  return <EmployeeList />;
}
