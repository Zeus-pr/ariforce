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
] as const satisfies readonly WorkTypeDefault[];

/**
 * Camp days use the same bands, territories, work-with and SFC as field work, and pay the same
 * TA/DA band. They do not count as a call-average field day and do not take doctor, chemist or
 * stockist calls. Migration 0065 inserts these for companies that already ran 0026.
 */
export const CAMP_WORK_TYPES = [
  {
    code: 'CAMP_HQ',
    name: 'Camp (HQ)',
    kind: 'field',
    countsAsFieldDay: false,
    allowanceBand: 'hq',
    requiresLocation: true,
  },
  {
    code: 'CAMP_EXHQ',
    name: 'Camp (ex-HQ)',
    kind: 'field',
    countsAsFieldDay: false,
    allowanceBand: 'ex_hq',
    requiresLocation: true,
  },
  {
    code: 'CAMP_OUT',
    name: 'Camp (outstation)',
    kind: 'field',
    countsAsFieldDay: false,
    allowanceBand: 'outstation',
    requiresLocation: true,
  },
] as const satisfies readonly WorkTypeDefault[];

type WorkTypeDefault = {
  code: string;
  name: string;
  kind: 'field' | 'non_field' | 'leave' | 'holiday';
  countsAsFieldDay: boolean;
  allowanceBand: 'hq' | 'ex_hq' | 'outstation' | 'none';
  requiresLocation: boolean;
};

/** Camp work-type codes (CAMP_HQ, CAMP_EXHQ, CAMP_OUT). */
export function isCampWorkType(code: string): boolean {
  return code.toUpperCase().startsWith('CAMP_');
}
