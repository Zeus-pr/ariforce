import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { ReportsView } from '@/components/expenses/reports-view';

export const metadata = { title: 'Expense reports' };

export default function ExpenseReportsPage() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4 sm:p-6">
      <Link
        href="/expenses"
        className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden /> All claims
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">Expense reports</h1>
      <ReportsView />
    </div>
  );
}
