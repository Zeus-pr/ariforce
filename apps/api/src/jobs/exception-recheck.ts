import { Injectable, Logger } from '@nestjs/common';
import type { Tx } from '@ariforce/db';
import type { Principal } from '../auth/principal';
import { companySettings, localDate } from '../field/field.util';
import { JobsService } from './jobs.service';

/** Coalescing window: one recheck per company and date per window. */
export const RECHECK_WINDOW_MS = 5 * 60_000;
/** Delay so a burst of submits is evaluated once, after the business transaction committed. */
export const RECHECK_DELAY_MS = 60_000;

export const recheckKey = (companyId: string, date: string, at: Date) =>
  `${companyId}:recheck:${date}:${Math.floor(at.getTime() / RECHECK_WINDOW_MS)}`;

/**
 * Event-driven exception evaluation (#56 promptness): after a DCR or tour plan submit, queue an
 * exceptions.evaluate job for that date (notify false) so dcr_missing / punch_without_dcr /
 * tp_not_submitted resolve (or raise) within about a minute instead of at the next daily run.
 * Same transaction, savepoint, never fails the action; coalesced per company, date and 5 minutes.
 */
@Injectable()
export class ExceptionRecheck {
  private readonly log = new Logger('ExceptionRecheck');
  constructor(private readonly jobs: JobsService) {}

  /** `date` defaults to today in the company's timezone (tour plan submits: tp_not_submitted). */
  async queue(tx: Tx, p: Principal, date?: string, at = new Date()) {
    try {
      const day = date ?? localDate(at, (await companySettings(tx, p)).timezone);
      await tx.transaction((sp) =>
        this.jobs.enqueue(
          sp,
          p.companyId,
          'exceptions.evaluate',
          { from: day, to: day, notify: false, trigger: 'event' },
          {
            dedupeKey: recheckKey(p.companyId, day, at),
            runAt: new Date(at.getTime() + RECHECK_DELAY_MS),
          },
        ),
      );
    } catch (e) {
      this.log.error(`recheck ${date ?? 'today'} failed: ${(e as Error).message}`);
    }
  }
}
