/// <reference types="jest" />
import { punchOutAsk } from '@/lib/punch-out';

describe('punch out prompt', () => {
  it('asks to submit when there is no report or it is still a draft', () => {
    expect(punchOutAsk(true, null)).toBe('submit_dcr');
    expect(punchOutAsk(true, 'draft')).toBe('submit_dcr');
    expect(punchOutAsk(true, 'rejected')).toBe('submit_dcr');
  });

  it('asks for confirmation when today’s report is already submitted or approved', () => {
    expect(punchOutAsk(true, 'submitted')).toBe('confirm');
    expect(punchOutAsk(true, 'approved')).toBe('confirm');
  });

  it('asks for confirmation when today’s report has not loaded yet', () => {
    expect(punchOutAsk(false, undefined)).toBe('confirm');
  });
});
