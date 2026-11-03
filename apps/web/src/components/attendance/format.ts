import type { CheckIn } from '@ariforce/contracts';

type CheckInKind = CheckIn['kind'];

export const KIND_LABEL: Record<CheckInKind, string> = {
  punch_in: 'Punch in',
  visit: 'Visit',
  punch_out: 'Punch out',
};
export const kindLabel = (k: CheckInKind) => KIND_LABEL[k];

const tf = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});
export const timeIST = (iso: string) => `${tf.format(new Date(iso))} IST`;

const df = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});
export const dateLabel = (ymd: string) => df.format(new Date(`${ymd}T12:00:00+05:30`));

const ymd = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
/** Today's date in IST as YYYY-MM-DD. */
export const todayIST = () => ymd.format(new Date());
