import { AttendanceView } from '@/components/attendance/attendance-view';

export const metadata = { title: 'Attendance' };

export default function AttendancePage() {
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 p-4 sm:p-6">
      <h1 className="text-2xl font-semibold tracking-tight">Attendance</h1>
      <AttendanceView />
    </div>
  );
}
