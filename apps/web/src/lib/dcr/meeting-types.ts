/**
 * The two meeting types offered in DCR and Tour Plan. Stored as the label text in `details.title`
 * (the API keeps it as free text); older entries with other titles still display as saved.
 */
export const MEETING_TYPES = ['Cycle Meeting', 'Review Meeting'] as const;
export type MeetingTypeLabel = (typeof MEETING_TYPES)[number];
export const DEFAULT_MEETING_TYPE: MeetingTypeLabel = 'Cycle Meeting';
export const isMeetingType = (v: string): v is MeetingTypeLabel =>
  (MEETING_TYPES as readonly string[]).includes(v);
