import { API_MODE } from '@/lib/api';
import { MyTeamView } from '@/components/my-team/my-team-view';

export const metadata = { title: 'My Team' };

export default function Page() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">My team</h1>
        {API_MODE === 'mock' && (
          <span
            className="rounded-full border border-dashed px-2 py-0.5 text-xs text-muted-foreground"
            data-testid="sample-badge"
          >
            Sample data
          </span>
        )}
      </div>
      <MyTeamView />
    </div>
  );
}
