/** IST date helpers for DCR (web components/attendance/format.ts). */

const ymd = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const df = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

const saved = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

const hhmm = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Kolkata',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** Today in IST as YYYY-MM-DD. */
export const todayIST = () => ymd.format(new Date());

export const dateLabel = (ymdStr: string) => df.format(new Date(`${ymdStr}T12:00:00+05:30`));

export const savedLabel = (iso: string) => `${saved.format(new Date(iso))} IST`;

export const nowHHmm = () => hhmm.format(new Date());

/** First day of the IST month containing `ymd`, as YYYY-MM-DD. */
export function monthStartIST(ymdStr?: string) {
  const d = ymdStr ?? todayIST();
  return `${d.slice(0, 7)}-01`;
}
