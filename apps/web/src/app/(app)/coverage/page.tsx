import { Suspense } from 'react';
import { CoverageView } from '@/components/performance/coverage-view';

export const metadata = { title: 'Coverage' };

export default function Page() {
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 p-4 sm:p-6">
      <h1 className="text-2xl font-semibold tracking-tight">Coverage</h1>
      <Suspense fallback={<div className="h-96" aria-busy="true" />}>
        <CoverageView />
      </Suspense>
    </div>
  );
}
