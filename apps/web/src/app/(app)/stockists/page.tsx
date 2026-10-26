import { MastersView } from '@/components/masters/masters-view';

export const metadata = { title: 'Stockists' };

export default function Page() {
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 p-4 sm:p-6">
      <h1 className="text-2xl font-semibold tracking-tight">Stockists</h1>
      <MastersView kind="stockists" />
    </div>
  );
}
