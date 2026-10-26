import { Suspense } from 'react';
import { TeamView } from '@/components/team/team-view';

export const metadata = { title: 'Team Performance' };

export default function TeamPage() {
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 p-4 sm:p-6">
      <h1 className="text-2xl font-semibold tracking-tight">Team performance</h1>
      <Suspense fallback={<div className="h-96" aria-busy="true" />}>
        <TeamView />
      </Suspense>
    </div>
  );
}
