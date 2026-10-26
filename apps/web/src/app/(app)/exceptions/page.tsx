import { Suspense } from 'react';
import { ExceptionsView } from '@/components/exceptions/exceptions-view';

export const metadata = { title: 'Exceptions' };

export default function ExceptionsPage() {
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Exceptions</h1>
        <p className="mt-1 text-sm text-muted-foreground">What needs attention, most serious first.</p>
      </div>
      <Suspense fallback={<div className="h-96" aria-busy="true" />}>
        <ExceptionsView />
      </Suspense>
    </div>
  );
}
