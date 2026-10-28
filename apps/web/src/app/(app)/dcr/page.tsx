import { DcrWorkspace } from '@/components/dcr/dcr-workspace';

export const metadata = { title: 'DCR' };

export default function DcrPage() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-4 sm:p-6">
      <h1 className="text-2xl font-semibold tracking-tight text-balance">Daily call report</h1>
      <DcrWorkspace />
    </div>
  );
}
