import { LeaveMaster } from '@/components/admin/leave-master';

export const metadata = { title: 'Leave setup' };

export default function Page() {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Leave setup</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Holidays are the company calendar. Leave is the number of days people get.
        </p>
      </div>
      <LeaveMaster />
    </div>
  );
}
