// Fixed English formats (not Intl), so Hermes on every device prints the same thing.
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;
const MONTHS_LONG = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

export function greeting(d: Date) {
  const h = d.getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

/** "Wed, 28 Oct 2026" */
export function formatDate(d: Date) {
  return `${formatDayMonth(d)} ${d.getFullYear()}`;
}

/** "Wed, 28 Oct" */
export function formatDayMonth(d: Date) {
  return `${WEEKDAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/** "November" */
export function monthName(d: Date) {
  return MONTHS_LONG[d.getMonth()] ?? '';
}

/** "09:12 AM" */
export function formatTime(d: Date) {
  const h = d.getHours() % 12 || 12;
  const m = d.getMinutes();
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')} ${d.getHours() < 12 ? 'AM' : 'PM'}`;
}

/** First letter of the name (the avatar shows one initial, as in the mockups). */
export function initial(name: string) {
  return name.trim().charAt(0).toUpperCase() || '?';
}
