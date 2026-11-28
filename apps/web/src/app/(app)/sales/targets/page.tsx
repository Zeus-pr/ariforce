import { Suspense } from 'react';
import { SetTargetsScreen } from '@/components/performance/set-targets-screen';

export const metadata = { title: 'Set targets' };

export default function Page() {
  return (
    <div className="mx-auto flex h-[calc(100dvh-var(--header-height))] w-full max-w-[90rem] flex-col p-4 sm:p-6">
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading targets.</p>}>
        <SetTargetsScreen />
      </Suspense>
    </div>
  );
}
