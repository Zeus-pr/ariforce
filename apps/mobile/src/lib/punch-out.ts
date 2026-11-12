/** What punch-out should ask, from today's DCR on Home. */
export type PunchOutAsk = 'submit_dcr' | 'confirm';

export function punchOutAsk(
  loaded: boolean,
  status: 'draft' | 'submitted' | 'approved' | 'rejected' | null | undefined,
): PunchOutAsk {
  if (loaded && (status === 'submitted' || status === 'approved')) return 'confirm';
  if (!loaded) return 'confirm';
  return 'submit_dcr';
}

export const PUNCH_OUT_SUBMIT = 'Submit today’s DCR before punching out.';
export const PUNCH_OUT_CONFIRM = 'Are you sure you want to punch out?';
