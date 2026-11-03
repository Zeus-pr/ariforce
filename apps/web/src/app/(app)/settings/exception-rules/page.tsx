import { RulesSettings } from '@/components/exceptions/rules-settings';

export const metadata = { title: 'Exception rules' };

export default function Page() {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Exception rules</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Turn rules on or off and set severity, thresholds and the suggested action. Changes apply
          from the next daily check.
        </p>
      </div>
      <RulesSettings />
    </div>
  );
}
