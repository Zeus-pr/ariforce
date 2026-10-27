import { Suspense } from 'react';
import { PeopleAdmin } from '@/components/admin/people-admin';

export const metadata = { title: 'People' };

export default function Page() {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">People</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Everyone in the company. Open a person to change their details, role, HQ, manager or
          status.
        </p>
      </div>
      <Suspense fallback={<div className="h-48 animate-pulse rounded-lg bg-muted/50" />}>
        <PeopleAdmin />
      </Suspense>
    </div>
  );
}
