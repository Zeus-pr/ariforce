import { describe, expect, it } from 'vitest';
import type { AllowanceDay } from '@ariforce/contracts';
import { autoDraftError, autoDraftPlan, claimMonth, rejectionPlan } from './auto-draft';

const base = {
  date: '2026-10-05',
  dcrId: '01930000-0000-7000-8000-000000000001',
  claimId: '01930000-0000-7000-8000-000000000002',
  claimStatus: 'draft' as const,
  claimCreated: false,
};
const day = (issues: AllowanceDay['issues'] = []): AllowanceDay => ({
  date: base.date,
  dcrId: base.dcrId,
  workTypeCode: 'FW',
  band: 'ex_hq',
  rateId: null,
  placeId: null,
  placeName: null,
  km: 40,
  da: 200,
  ta: 118,
  issues,
});
const lines = [
  { amount: 200, category: 'allowance', mileageKm: null },
  { amount: 118, category: 'mileage', mileageKm: 40 },
];

describe('autoDraftPlan', () => {
  it('drafts DA + TA on an editable claim', () => {
    const r = autoDraftPlan(base, 'draft', day(), lines);
    expect(r.write).toBe(true);
    expect(r.result).toMatchObject({
      status: 'drafted',
      reason: null,
      lines: 2,
      da: 200,
      ta: 118,
      km: 40,
    });
  });
  it('also drafts on a rejected claim (editable)', () => {
    expect(autoDraftPlan(base, 'rejected', day(), lines).write).toBe(true);
  });
  it.each(['submitted', 'approved', 'paid'])('skips a %s claim (claim_locked)', (s) => {
    const r = autoDraftPlan(base, s, day(), lines);
    expect(r).toMatchObject({
      write: false,
      result: { status: 'skipped', reason: 'claim_locked', lines: 0 },
    });
  });
  it('a manual allowance/mileage line on the day wins', () => {
    const r = autoDraftPlan(base, 'draft', day(['manual_line_exists']), []);
    expect(r.result).toMatchObject({ status: 'skipped', reason: 'manual_line_exists' });
  });
  it('nothing computed (band none / no rate) is no_allowance, issues kept', () => {
    expect(autoDraftPlan(base, 'draft', undefined, []).result.reason).toBe('no_allowance');
    const r = autoDraftPlan(base, 'draft', day(['no_rate']), []);
    expect(r.result).toMatchObject({ reason: 'no_allowance', issues: ['no_rate'] });
  });
  it('engine problems ride along when lines are drafted', () => {
    const r = autoDraftPlan(base, 'draft', day(['place_required']), [lines[0]!]);
    expect(r.result).toMatchObject({
      status: 'drafted',
      issues: ['place_required'],
      ta: 0,
      da: 200,
    });
  });
});

describe('autoDraftError', () => {
  it('keeps an API error code, never throws', () => {
    const e = Object.assign(new Error('Place band'), { response: { code: 'PLACE_NOT_USABLE' } });
    expect(autoDraftError(base, e)).toMatchObject({
      status: 'error',
      lines: 0,
      error: { code: 'PLACE_NOT_USABLE', message: 'Place band' },
    });
    expect(autoDraftError(base, 'boom').error).toEqual({
      code: 'AUTO_DRAFT_FAILED',
      message: 'boom',
    });
    expect(autoDraftError(base, { code: '23505', message: 'dup' }).error!.code).toBe(
      'AUTO_DRAFT_FAILED',
    );
  });
});

describe('rejectionPlan', () => {
  const ls = [
    { id: 'a', source: 'auto', flagged: false },
    { id: 'm', source: 'manual', flagged: false },
    { id: 'f', source: 'manual', flagged: true },
  ];
  it('editable claim: removes auto lines, flags the rest once', () => {
    expect(rejectionPlan('draft', ls)).toEqual({ editable: true, remove: ['a'], flag: ['m'] });
    expect(rejectionPlan('rejected', ls).remove).toEqual(['a']);
  });
  it.each(['submitted', 'approved', 'paid'])('%s claim: removes nothing, flags every line', (s) => {
    expect(rejectionPlan(s, ls)).toEqual({ editable: false, remove: [], flag: ['a', 'm'] });
  });
});

describe('claimMonth', () => {
  it('is the first of the month', () => expect(claimMonth('2026-10-29')).toBe('2026-10-01'));
});
