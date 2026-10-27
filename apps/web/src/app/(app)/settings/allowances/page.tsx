import { AllowanceSettings } from '@/components/allowances/allowance-settings';

export const metadata = { title: 'TA/DA rates' };

export default function Page() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">TA/DA rates</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          The rate card (DA per day, TA per km and flat TA per band) and the fare chart of places per HQ used to draft allowances on expense claims.
        </p>
      </div>
      <AllowanceSettings />
    </div>
  );
}
