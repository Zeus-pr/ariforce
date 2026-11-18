import type { Metadata } from 'next';
import { AppointmentLetters } from '@/components/hrms/appointment-letter';

export const metadata: Metadata = { title: 'Appointment letter' };

export default function HrLettersPage() {
  return <AppointmentLetters />;
}
