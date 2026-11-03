/**
 * Everyone the signed-in user may see (GET /v1/team: the caller plus their reporting-line subtree;
 * the whole company for a Director), cached with React Query. Reuses the team adapter's loader.
 */
import { useQuery } from '@tanstack/react-query';
import { apiTeamAdapter } from '@/lib/team-adapter/api-adapter';
import type { Employee } from '@/lib/team-adapter/types';
import { LONG_STALE } from '@/lib/query';
import type { Role } from '@/lib/roles';

export type TeamPeople = { rootId: string; people: Employee[]; byId: Map<string, Employee> };

export const teamPeopleQuery = (role: Role) => ({
  queryKey: ['team-people', role] as const,
  queryFn: async (): Promise<TeamPeople> => {
    const tree = await apiTeamAdapter.tree(role);
    const unassigned = await apiTeamAdapter.unassigned(role);
    const people = [...tree.nodes, ...unassigned.items];
    return { rootId: tree.rootId, people, byId: new Map(people.map((p) => [p.id, p])) };
  },
  staleTime: LONG_STALE,
});

export const useTeamPeople = (role: Role, enabled = true) =>
  useQuery({ ...teamPeopleQuery(role), enabled });
