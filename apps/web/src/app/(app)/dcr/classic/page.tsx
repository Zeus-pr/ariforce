import Link from 'next/link';
import { DcrView } from '@/components/dcr/dcr-view';

export const metadata = { title: 'DCR (classic form)' };

/**
 * The pre-redesign DCR form on PUT /v1/dcrs (TP prefill, samples, POB and RCPA per call). Kept while the
 * redesigned /dcr settles; not in the navigation.
 */
export default function DcrClassicPage() {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Daily call report (classic form)</h1>
        <Link href="/dcr" className="text-sm text-primary underline-offset-4 hover:underline">
          Open the new DCR
        </Link>
      </div>
      <DcrView />
    </div>
  );
}
