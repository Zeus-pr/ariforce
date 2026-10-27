import { ExpensesView } from '@/components/expenses/expenses-view';

export const metadata = { title: 'Expenses' };

export default function ExpensesPage() {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-4 sm:p-6">
      <h1 className="text-2xl font-semibold tracking-tight">Expenses</h1>
      <ExpensesView />
    </div>
  );
}
