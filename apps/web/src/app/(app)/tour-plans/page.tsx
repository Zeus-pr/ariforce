import { TourPlansView } from '@/components/tour-plans/tour-plans-view';

export const metadata = { title: 'Tour plans' };

export default function TourPlansPage() {
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 p-4 sm:p-6">
      <h1 className="text-2xl font-semibold tracking-tight">Tour plans</h1>
      <TourPlansView />
    </div>
  );
}
