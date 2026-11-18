import type { Metadata } from 'next';
import { EmployeeForm } from '@/components/hrms/employee-form';

export const metadata: Metadata = { title: 'Employee' };

export default async function EmployeePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <EmployeeForm personId={id} />;
}
