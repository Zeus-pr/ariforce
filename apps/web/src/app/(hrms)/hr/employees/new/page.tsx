import type { Metadata } from 'next';
import { EmployeeForm } from '@/components/hrms/employee-form';

export const metadata: Metadata = { title: 'New employee' };

export default function NewEmployeePage() {
  return <EmployeeForm personId={null} />;
}
