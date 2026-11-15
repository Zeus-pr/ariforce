/** Calendar date as YYYY-MM-DD. node-pg returns a DATE as local midnight, which JSON turns into the previous evening in India. */
export function holidayDate(value: string | Date): string {
  if (typeof value === 'string') return value.slice(0, 10);
  const y = value.getFullYear();
  const m = String(value.getMonth() + 1).padStart(2, '0');
  const d = String(value.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
