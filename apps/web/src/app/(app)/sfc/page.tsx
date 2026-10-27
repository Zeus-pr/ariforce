import { SfcScreen } from '@/components/sfc/sfc-screen';

export const metadata = { title: 'SFC' };

export default function Page() {
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">SFC</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Standard fare chart for each person in your team. Pick an HQ, then a person, then edit
          their TA/DA routes.
        </p>
      </div>
      <SfcScreen />
    </div>
  );
}
