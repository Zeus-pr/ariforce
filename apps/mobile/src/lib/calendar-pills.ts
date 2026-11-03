/**
 * Shared month-grid pill model for Tour Plan and DCR calendars
 * (Outlook/Teams-style short labels inside each day cell).
 */
export type CalendarPillStatus = 'draft' | 'pending' | 'approved' | 'rejected' | 'tp';

export type DayPill = {
  date: string;
  /** Short line shown in the day cell (names / territory). */
  label: string;
  status: CalendarPillStatus;
  itemId: string;
};

/** Truncate for a narrow day cell without cutting mid-word when possible. */
export function shortLabel(raw: string, max = 16): string {
  const t = raw.trim().replace(/\s+/g, ' ');
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const sp = cut.lastIndexOf(' ');
  return `${(sp > 6 ? cut.slice(0, sp) : cut).trimEnd()}…`;
}

/** Join a few names for a day cell: "Dr A, Chem B". */
export function joinShort(parts: string[], maxParts = 2, maxLen = 16): string {
  const clean = parts.map((p) => p.trim()).filter(Boolean);
  if (!clean.length) return '';
  return shortLabel(clean.slice(0, maxParts).join(', '), maxLen);
}
