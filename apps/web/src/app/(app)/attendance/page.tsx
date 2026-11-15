import { redirect } from 'next/navigation';

/** Punch-in lives on the phone. The old website attendance page is no longer shown. */
export default function AttendancePage() {
  redirect('/');
}
