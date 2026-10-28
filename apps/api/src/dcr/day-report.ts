import { sql, type AnyColumn, type SQL } from 'drizzle-orm';

/**
 * Multi-draft DCRs (migration 0045): a user may keep several drafts for a date, but at most one
 * live report of the date counts as submitted (status 'submitted' or 'approved'; partial unique
 * index dcrs_user_date_submitted_uq). Everything that reads "the DCR of a day" uses the day report:
 * the live submitted report if any, else the latest draft (updated_at desc, id desc).
 */
export const SUBMITTED_STATUSES = ['submitted', 'approved'] as const;
export const DAY_SUBMITTED_INDEX = 'dcrs_user_date_submitted_uq';
/** The pre-0045 full unique index (only while 0045 is not applied, or after a DB rollback). */
export const LEGACY_DAY_INDEX = 'dcrs_user_date_uq';

export interface DayRow {
  id: string;
  date: string;
  status: string;
  version: number;
  updatedAt: Date | string;
  deletedAt?: Date | string | null;
}

const ts = (v: Date | string) => (v instanceof Date ? v.getTime() : Date.parse(v));
export const isSubmitted = (r: Pick<DayRow, 'status'>) =>
  (SUBMITTED_STATUSES as readonly string[]).includes(r.status);
const live = <T extends DayRow>(rows: T[]) => rows.filter((r) => !r.deletedAt);

/** Drafts newest first (updated_at desc, id desc), live rows only. */
export function draftsNewestFirst<T extends DayRow>(rows: T[]): T[] {
  return live(rows)
    .filter((r) => r.status === 'draft')
    .sort((a, b) => ts(b.updatedAt) - ts(a.updatedAt) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
}
export const submittedOf = <T extends DayRow>(rows: T[]): T | undefined =>
  live(rows).find(isSubmitted);
/** The day report: the submitted one, else the latest draft. */
export const dayReport = <T extends DayRow>(rows: T[]): T | undefined =>
  submittedOf(rows) ?? draftsNewestFirst(rows)[0];

export type Resolution<T> =
  | { action: 'update'; row: T }
  | { action: 'create' }
  | { action: 'error'; status: 404 | 409 | 422; code: string; message: string; details?: unknown };

/**
 * PUT /v1/dcrs/draft target. `byId` is the caller's live DCR with input.id (undefined if none);
 * `day` are the caller's live DCRs of input.date.
 * - id: update that draft (404 if missing, 409 ALREADY_SUBMITTED if not a draft, 422 on another date).
 * - no id, version (older clients that upserted per day): update the latest draft of the date.
 * - no id, no version: create a new draft.
 * A date that already has a submitted report takes no draft saves (409 DAY_ALREADY_SUBMITTED).
 */
export function resolveDraftTarget<T extends DayRow>(
  input: { id?: string; date: string; version?: number },
  byId: T | undefined,
  day: T[],
): Resolution<T> {
  let row: T | undefined;
  if (input.id) {
    if (!byId || byId.deletedAt)
      return { action: 'error', status: 404, code: 'NOT_FOUND', message: 'Draft not found' };
    if (byId.status !== 'draft')
      return {
        action: 'error',
        status: 409,
        code: 'ALREADY_SUBMITTED',
        message: 'Submitted DCRs are read-only; request a correction',
        details: { id: byId.id },
      };
    if (byId.date !== input.date)
      return {
        action: 'error',
        status: 422,
        code: 'VALIDATION',
        message: 'date must equal the date of the draft',
        details: { field: 'date', expected: byId.date },
      };
    row = byId;
  }
  const sub = submittedOf(day);
  if (sub)
    return {
      action: 'error',
      status: 409,
      code: 'DAY_ALREADY_SUBMITTED',
      message: 'This day already has a submitted report',
      details: { existingId: sub.id },
    };
  if (!input.id && input.version) {
    row = draftsNewestFirst(day)[0];
    if (!row)
      return {
        action: 'error',
        status: 409,
        code: 'VERSION_CONFLICT',
        message: 'Stale version: the draft is gone; reload',
      };
  }
  if (row && input.version && input.version !== row.version)
    return { action: 'error', status: 409, code: 'VERSION_CONFLICT', message: 'Stale version' };
  return row ? { action: 'update', row } : { action: 'create' };
}

/** Another live submitted report of the same date blocks a submit (returns its id). */
export function submitConflict<T extends DayRow>(curId: string, day: T[]): string | null {
  return live(day).find((r) => r.id !== curId && isSubmitted(r))?.id ?? null;
}

/** pg unique violation on the one-submitted-per-day index (drizzle wraps it in `.cause`). */
export function isDaySubmittedViolation(e: unknown): boolean {
  for (let c: unknown = e, i = 0; c && i < 4; c = (c as { cause?: unknown }).cause, i++) {
    const x = c as { code?: string; constraint?: string };
    if (
      x.code === '23505' &&
      (x.constraint === DAY_SUBMITTED_INDEX || x.constraint === LEGACY_DAY_INDEX)
    )
      return true;
  }
  return false;
}

/**
 * Drizzle filter: this dcrs row is the day report of its user and date (see dayReport).
 * Pass the outer query's dcrs columns (works with aliases).
 */
export function isDayReport(c: {
  id: AnyColumn;
  companyId: AnyColumn;
  userId: AnyColumn;
  date: AnyColumn;
}): SQL {
  return sql`${c.id} = (select x.id from dcrs x where x.company_id = ${c.companyId} and x.user_id = ${c.userId} and x.date = ${c.date} and x.deleted_at is null order by (x.status = 'draft'), x.updated_at desc, x.id desc limit 1)`;
}

/** Raw-SQL form of isDayReport for a dcrs alias in a hand-written query, e.g. `and ${dayReportSql('d')}`. */
export function dayReportSql(alias: string): SQL {
  if (!/^[a-z_][a-z0-9_]*$/.test(alias)) throw new Error(`bad alias ${alias}`);
  const a = alias;
  return sql.raw(
    `${a}.id = (select x.id from dcrs x where x.company_id = ${a}.company_id and x.user_id = ${a}.user_id and x.date = ${a}.date and x.deleted_at is null order by (x.status = 'draft'), x.updated_at desc, x.id desc limit 1)`,
  );
}

/**
 * Submitted-only (drafts ignored, no fallback): the dcrs row is a live submitted/approved report.
 * Used where a draft must not count (team calendar, leave clash, team attendance; KPIs use the
 * 0046 views). Pass the outer query's dcrs columns.
 */
export function isSubmittedReport(c: { status: AnyColumn; deletedAt: AnyColumn }): SQL {
  return sql`(${c.deletedAt} is null and ${c.status} in ('submitted', 'approved'))`;
}

/** Raw-SQL form of isSubmittedReport for a dcrs alias, e.g. `and ${submittedReportSql('d')}`. */
export function submittedReportSql(alias: string): SQL {
  if (!/^[a-z_][a-z0-9_]*$/.test(alias)) throw new Error(`bad alias ${alias}`);
  return sql.raw(`(${alias}.deleted_at is null and ${alias}.status in ('submitted', 'approved'))`);
}

/** In-memory form: live submitted/approved rows only. */
export const submittedOnly = <T extends DayRow>(rows: T[]): T[] => live(rows).filter(isSubmitted);
