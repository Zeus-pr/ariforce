/**
 * GET /v1/me/today — caller-scoped punch + tour plan + DCR for Home.
 * Prefer this over team-wide GET /v1/check-ins for duty state.
 */
import type { MeToday } from '@ariforce/contracts';
import { apiFetch } from './api';

export type { MeToday };

export async function fetchMeToday(): Promise<MeToday> {
  return apiFetch<MeToday>('/v1/me/today');
}

/** Today: punched in and not yet punched out (this user only). */
export function dutyFromMeToday(t: MeToday): {
  onDuty: boolean;
  punchedInAt: Date | null;
} {
  return {
    onDuty: t.punch.status === 'in',
    punchedInAt: t.punch.inAt ? new Date(t.punch.inAt) : null,
  };
}

/** Home daily-target strip from MeToday (+ optional visit check-in count). */
export function dailyTargetFromMeToday(
  t: MeToday,
  visitsDone: number,
): {
  done: number;
  total: number;
  cluster: string;
  stp: string;
  hasPlanTarget: boolean;
} {
  const total = t.tourPlan.plannedVisits;
  const done = Math.min(Math.max(0, visitsDone), total > 0 ? total : visitsDone);
  const wt = t.tourPlan.workTypeName?.trim();
  const nTerr = t.tourPlan.territoryIds.length;
  const cluster =
    nTerr > 0 ? `${nTerr} territor${nTerr === 1 ? 'y' : 'ies'}` : wt ? wt : 'Field day';
  const stp = wt ?? (t.tourPlan.itemId ? 'Tour plan' : 'No plan');
  return {
    done: total > 0 ? Math.min(visitsDone, total) : visitsDone,
    total,
    cluster,
    stp,
    hasPlanTarget: total > 0,
  };
}
