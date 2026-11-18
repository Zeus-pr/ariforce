import type { Metadata } from 'next';
import { HrExpenses } from '@/components/hrms/expenses';

export const metadata: Metadata = { title: 'Expenses' };

export default function HrExpensesPage() {
  return <HrExpenses />;
}
