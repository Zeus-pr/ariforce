import { Suspense } from 'react';
import { DoctorsView } from '@/components/doctors/doctors-view';

export const metadata = { title: 'Doctors' };

export default function DoctorsPage() {
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 p-4 sm:p-6">
      <h1 className="text-2xl font-semibold tracking-tight">Doctors</h1>
      <Suspense fallback={<div className="h-96" aria-busy="true" />}>
        <DoctorsView />
      </Suspense>
    </div>
  );
}
