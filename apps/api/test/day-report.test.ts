import { describe, expect, it } from 'vitest';
import {
  dayReport,
  dayReportSql,
  draftsNewestFirst,
  isDaySubmittedViolation,
  resolveDraftTarget,
  submitConflict,
} from '../src/dcr/day-report';

const D = '2026-10-28';
const row = (
  id: string,
  status: string,
  updatedAt: string,
  version = 1,
  deletedAt: string | null = null,
) => ({
  id,
  date: D,
  status,
  version,
  updatedAt: new Date(updatedAt),
  deletedAt: deletedAt ? new Date(deletedAt) : null,
});
const a = row('a', 'draft', '2026-10-28T08:00:00Z', 2);
const b = row('b', 'draft', '2026-10-28T09:00:00Z', 5);
const gone = row('g', 'draft', '2026-10-28T10:00:00Z', 1, '2026-10-28T10:05:00Z');
const sub = row('s', 'submitted', '2026-10-28T07:00:00Z', 3);

describe('day report', () => {
  it('orders drafts newest first and skips deleted ones', () => {
    expect(draftsNewestFirst([a, gone, b]).map((r) => r.id)).toEqual(['b', 'a']);
  });
  it('breaks updatedAt ties by id desc', () => {
    const x = row('x', 'draft', '2026-10-28T09:00:00Z');
    expect(draftsNewestFirst([b, x]).map((r) => r.id)).toEqual(['x', 'b']);
  });
  it('is the submitted report, else the latest draft', () => {
    expect(dayReport([a, b, sub])?.id).toBe('s');
    expect(dayReport([a, b])?.id).toBe('b');
    expect(dayReport([gone])).toBeUndefined();
  });
  it('raw SQL helper rejects odd aliases', () => {
    expect(() => dayReportSql('d; drop')).toThrow();
    expect(dayReportSql('d')).toBeTruthy();
  });
});

describe('resolveDraftTarget', () => {
  it('creates a new draft without id and version', () => {
    expect(resolveDraftTarget({ date: D }, undefined, [a, b])).toEqual({ action: 'create' });
  });
  it('updates the draft named by id (version checked)', () => {
    expect(resolveDraftTarget({ id: 'a', date: D, version: 2 }, a, [a, b])).toEqual({
      action: 'update',
      row: a,
    });
    expect(resolveDraftTarget({ id: 'a', date: D, version: 1 }, a, [a, b])).toMatchObject({
      action: 'error',
      status: 409,
      code: 'VERSION_CONFLICT',
    });
  });
  it('404 for an unknown or deleted id, 409 for a non-draft, 422 for another date', () => {
    expect(resolveDraftTarget({ id: 'z', date: D }, undefined, [a])).toMatchObject({ status: 404 });
    expect(resolveDraftTarget({ id: 'g', date: D }, gone, [a])).toMatchObject({ status: 404 });
    expect(resolveDraftTarget({ id: 's', date: D }, sub, [sub])).toMatchObject({
      status: 409,
      code: 'ALREADY_SUBMITTED',
    });
    expect(resolveDraftTarget({ id: 'a', date: '2026-10-27' }, a, [])).toMatchObject({
      status: 422,
      code: 'VALIDATION',
    });
  });
  it('older clients (no id, version) update the latest draft', () => {
    expect(resolveDraftTarget({ date: D, version: 5 }, undefined, [a, b])).toEqual({
      action: 'update',
      row: b,
    });
    expect(resolveDraftTarget({ date: D, version: 2 }, undefined, [a, b])).toMatchObject({
      code: 'VERSION_CONFLICT',
    });
    expect(resolveDraftTarget({ date: D, version: 2 }, undefined, [])).toMatchObject({
      code: 'VERSION_CONFLICT',
    });
  });
  it('a day with a submitted report takes no draft saves', () => {
    for (const input of [{ date: D }, { id: 'a', date: D }, { date: D, version: 2 }])
      expect(resolveDraftTarget(input, input.id ? a : undefined, [a, sub])).toEqual({
        action: 'error',
        status: 409,
        code: 'DAY_ALREADY_SUBMITTED',
        message: expect.any(String),
        details: { existingId: 's' },
      });
  });
});

describe('submit conflict', () => {
  it('blocks a submit when another report of the day is submitted', () => {
    expect(submitConflict('a', [a, b, sub])).toBe('s');
    expect(submitConflict('a', [a, b])).toBeNull();
    expect(submitConflict('s', [sub])).toBeNull();
    expect(submitConflict('a', [a, { ...sub, deletedAt: new Date() }])).toBeNull();
    expect(submitConflict('a', [a, { ...sub, status: 'approved' }])).toBe('s');
  });
  it('recognises the unique violation, wrapped or not', () => {
    const pg = { code: '23505', constraint: 'dcrs_user_date_submitted_uq' };
    expect(isDaySubmittedViolation(pg)).toBe(true);
    expect(isDaySubmittedViolation({ message: 'Failed query', cause: pg })).toBe(true);
    expect(
      isDaySubmittedViolation({ cause: { code: '23505', constraint: 'dcrs_user_date_uq' } }),
    ).toBe(true);
    expect(
      isDaySubmittedViolation({ cause: { code: '23505', constraint: 'dcrs_submit_key_uq' } }),
    ).toBe(false);
    expect(isDaySubmittedViolation(new Error('x'))).toBe(false);
  });
});
