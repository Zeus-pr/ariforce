/**
 * Standard work types every company gets (migration 0026_work_types_defaults, dev/test seed,
 * admin:create-first). Codes match the rows hand-inserted in prod for 'arighna'; labels here are
 * our defaults (existing rows are never overwritten: ON CONFLICT (company_id, code) DO NOTHING).
 */
export const DEFAULT_WORK_TYPES = [
  {
    code: 'FIELD_HQ',
    name: 'Field work (HQ)',
    kind: 'field',
    countsAsFieldDay: true,
    allowanceBand: 'hq',
    requiresLocation: true,
  },
  {
    code: 'FIELD_EXHQ',
    name: 'Field work (ex-HQ)',
    kind: 'field',
    countsAsFieldDay: true,
    allowanceBand: 'ex_hq',
    requiresLocation: true,
  },
  {
    code: 'FIELD_OUT',
    name: 'Field work (outstation)',
    kind: 'field',
    countsAsFieldDay: true,
    allowanceBand: 'outstation',
    requiresLocation: true,
  },
  {
    code: 'MEETING',
    name: 'Meeting',
    kind: 'non_field',
    countsAsFieldDay: false,
    allowanceBand: 'none',
    requiresLocation: false,
  },
  {
    code: 'TRAINING',
    name: 'Training',
    kind: 'non_field',
    countsAsFieldDay: false,
    allowanceBand: 'none',
    requiresLocation: false,
  },
  {
    code: 'OFFICE',
    name: 'Office work',
    kind: 'non_field',
    countsAsFieldDay: false,
    allowanceBand: 'none',
    requiresLocation: false,
  },
  {
    code: 'LEAVE',
    name: 'Leave',
    kind: 'leave',
    countsAsFieldDay: false,
    allowanceBand: 'none',
    requiresLocation: false,
  },
  {
    code: 'HOLIDAY',
    name: 'Holiday',
    kind: 'holiday',
    countsAsFieldDay: false,
    allowanceBand: 'none',
    requiresLocation: false,
  },
] as const satisfies readonly {
  code: string;
  name: string;
  kind: 'field' | 'non_field' | 'leave' | 'holiday';
  countsAsFieldDay: boolean;
  allowanceBand: 'hq' | 'ex_hq' | 'outstation' | 'none';
  requiresLocation: boolean;
}[];
