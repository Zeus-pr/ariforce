import { useQuery } from '@tanstack/react-query';
import type { TeamMemberActivity } from '@ariforce/contracts';
import { api, apiReady } from '@/lib/api';
import { failureMessage } from '@/lib/dcr/errors';

/**
 * Employee 360 backbone: GET /v1/team/members/{userId}/activity (contract #128). One call per
 * range serves Today, DCRs, Tour plan vs actual, Attendance and the daily view.
 */
export function useMemberActivity(userId: string, from: string, to: string, enabled = true) {
  return useQuery({
    queryKey: ['member-activity', userId, from, to],
    enabled: enabled && !!from && !!to,
    queryFn: async (): Promise<TeamMemberActivity> => {
      await apiReady();
      const r = await api.GET('/v1/team/members/{userId}/activity', {
        params: { path: { userId }, query: { from, to } },
      });
      if (!r.data) throw new Error(failureMessage(r, 'Could not load activity.'));
      return r.data as TeamMemberActivity;
    },
  });
}
