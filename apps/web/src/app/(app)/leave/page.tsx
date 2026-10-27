import { LeaveView } from '@/components/leave/leave-view';

export const metadata = { title: 'Leave' };

export default function LeavePage() {
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 p-4 sm:p-6">
      <h1 className="text-2xl font-semibold tracking-tight">Leave</h1>
      <LeaveView />
    </div>
  );
}
