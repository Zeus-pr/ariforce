'use client';

import { useEffect, useState } from 'react';
import { TreeFlow } from '@/components/flow/tree-flow';
import { listPeople, type Person } from '@/lib/people/adapter';
import { seatIsVacant } from '@/lib/people/seat';
import { roleLabel } from '@/lib/roles';

const ROLE_COLOR: Record<string, string> = {
  director: '#7c3aed',
  vice_president: '#6d28d9',
  general_manager: '#1d4ed8',
  sales_manager: '#0369a1',
  zonal_business_manager: '#0e7490',
  regional_business_manager: '#0f766e',
  area_business_manager: '#047857',
  business_manager: '#b45309',
  hr: '#be185d',
  system_admin: '#475569',
  distribution_head: '#0f766e',
};

export function OrgChart() {
  const [people, setPeople] = useState<Person[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const rows: Person[] = [];
        let cursor: string | undefined;
        for (let i = 0; i < 20; i++) {
          const page = await listPeople({ cursor, limit: 50 });
          rows.push(...page.items);
          cursor = page.nextCursor ?? undefined;
          if (!cursor) break;
        }
        if (live) setPeople(rows);
      } catch (e) {
        if (live) setError(e instanceof Error ? e.message : 'Could not load the chart.');
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  const ids = new Set((people ?? []).map((p) => p.id));
  const items = (people ?? []).map((person) => {
    const role = person.primaryRole ?? person.roles[0] ?? '';
    const vacant = seatIsVacant(person);
    const place = person.territories?.[0]?.name;
    return {
      id: person.id,
      parentId: person.managerId && ids.has(person.managerId) ? person.managerId : null,
      title: vacant ? 'Vacant' : person.name,
      subtitle: vacant
        ? [place, roleLabel(role)].filter(Boolean).join(' · ')
        : [person.employeeCode, person.designation, roleLabel(role)].filter(Boolean).join(' · '),
      color: vacant ? '#94a3b8' : (ROLE_COLOR[role] ?? '#64748b'),
    };
  });

  return (
    <div className="relative h-[calc(100dvh-var(--header-height))] min-h-0">
      {error && (
        <p role="alert" className="absolute top-3 left-3 z-10 text-sm text-destructive">
          {error}
        </p>
      )}
      {people === null && !error && (
        <p className="absolute top-3 left-3 z-10 text-sm text-muted-foreground">Loading…</p>
      )}
      {people && items.length === 0 && (
        <p className="p-6 text-sm text-muted-foreground">No employees yet.</p>
      )}
      {people && items.length > 0 && <TreeFlow nodes={items} label="Organizational chart" />}
    </div>
  );
}
