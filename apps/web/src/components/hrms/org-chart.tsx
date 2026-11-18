'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { listPeople, type Person } from '@/lib/people/adapter';
import { roleLabel } from '@/lib/roles';

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

  const byManager = new Map<string | null, Person[]>();
  for (const person of people ?? []) {
    const key = person.managerId;
    byManager.set(key, [...(byManager.get(key) ?? []), person]);
  }
  const ids = new Set((people ?? []).map((p) => p.id));
  const roots = (people ?? []).filter((p) => !p.managerId || !ids.has(p.managerId));

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-6">
      <h1 className="text-lg font-semibold">Organizational chart</h1>
      <p className="text-sm text-muted-foreground">
        Who reports to whom, from the employee records.
      </p>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {people === null && !error && <p className="text-sm text-muted-foreground">Loading…</p>}
      {people && roots.length === 0 && (
        <p className="text-sm text-muted-foreground">No employees yet.</p>
      )}
      {people && roots.length > 0 && <Tree nodes={roots} byManager={byManager} />}
    </div>
  );
}

function Tree({ nodes, byManager }: { nodes: Person[]; byManager: Map<string | null, Person[]> }) {
  if (!nodes.length) return null;
  return (
    <ul className="grid gap-2">
      {nodes.map((person) => (
        <li key={person.id} className="rounded-lg border p-3">
          <Link href={`/hr/employees/${person.id}`} className="font-medium text-primary">
            {person.name}
          </Link>
          <p className="text-xs text-muted-foreground">
            {[
              person.employeeCode,
              person.designation,
              roleLabel(person.primaryRole ?? person.roles[0]),
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
          {(byManager.get(person.id)?.length ?? 0) > 0 && (
            <div className="mt-2 border-l pl-3">
              <Tree nodes={byManager.get(person.id) ?? []} byManager={byManager} />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
