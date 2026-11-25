import type { PlannedDoctors } from '@ariforce/contracts';

export type ScheduleRow = {
  id: string;
  name: string;
  detail: string;
  visited: boolean;
};

/** Today's tour-plan visits only. Territory doctors are not a schedule, and no clock time is invented. */
export function scheduleFromPlan(items: PlannedDoctors['items']): ScheduleRow[] {
  return items
    .filter((item) => item.source === 'tour_plan')
    .map((item) => ({
      id: item.doctorId,
      name: item.name,
      detail: item.visited ? 'Called today' : 'On today’s tour plan',
      visited: item.visited,
    }));
}
