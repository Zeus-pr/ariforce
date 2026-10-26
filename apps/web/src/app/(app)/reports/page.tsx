import { Suspense } from 'react';
import { ReportsView } from '@/components/reports/reports-view';

export const metadata = { title: 'Reports' };

export default function Page() {
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 p-4 sm:p-6">
      <h1 className="text-2xl font-semibold tracking-tight">Reports</h1>
      <Suspense fallback={<div className="h-96" aria-busy="true" />}>
        <ReportsView />
      </Suspense>
    </div>
  );
}
