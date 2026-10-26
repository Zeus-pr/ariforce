import { DcrView } from '@/components/dcr/dcr-view';

export const metadata = { title: 'DCR' };

export default function DcrPage() {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-4 sm:p-6">
      <h1 className="text-2xl font-semibold tracking-tight">Daily call report</h1>
      <DcrView />
    </div>
  );
}
