import { MyTeamView } from '@/components/my-team/my-team-view';

export const metadata = { title: 'My Team' };

export default function Page() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">My team</h1>
      </div>
      <MyTeamView />
    </div>
  );
}
