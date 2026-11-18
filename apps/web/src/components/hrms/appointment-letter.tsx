'use client';

import { useEffect, useState } from 'react';
import { listPeople, type Person } from '@/lib/people/adapter';
import { useRole } from '@/components/shell/role-context';

export function AppointmentLetters() {
  const { user } = useRole();
  const [people, setPeople] = useState<Person[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Person | null>(null);

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
        if (live) setPeople(rows.filter((p) => p.joinedOn));
      } catch (e) {
        if (live) setError(e instanceof Error ? e.message : 'Could not load people.');
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-6">
      <h1 className="text-lg font-semibold">Appointment letter</h1>
      <p className="text-sm text-muted-foreground">
        Printed from the employee record: name, designation, department, and date of joining.
      </p>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {people === null && !error && <p className="text-sm text-muted-foreground">Loading…</p>}
      {people && !picked && (
        <ul className="grid gap-2">
          {people.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                className="text-left text-sm text-primary"
                onClick={() => setPicked(p)}
              >
                {p.name}
                <span className="text-muted-foreground"> · {p.joinedOn}</span>
              </button>
            </li>
          ))}
          {people.length === 0 && (
            <li className="text-sm text-muted-foreground">No one has a date of joining yet.</li>
          )}
        </ul>
      )}
      {picked && (
        <article className="max-w-2xl rounded-lg border bg-card p-8 text-sm leading-relaxed">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{user.territory}</p>
          <h2 className="mt-6 text-lg font-semibold">Appointment confirmation</h2>
          <p className="mt-4">Dear {picked.name},</p>
          <p className="mt-3">
            This confirms your appointment
            {picked.designation ? ` as ${picked.designation}` : ''}
            {picked.department ? ` in ${picked.department}` : ''}
            {picked.joinedOn ? `, joining on ${picked.joinedOn}` : ''}.
            {picked.employeeCode ? ` Your employee code is ${picked.employeeCode}.` : ''}
          </p>
          <p className="mt-3">
            Your place in the company and the person you report to are the ones saved on your
            employee record.
          </p>
          <p className="mt-8">{user.territory}</p>
          <div className="mt-6 flex gap-2 print:hidden">
            <button type="button" className="text-sm text-primary" onClick={() => window.print()}>
              Print
            </button>
            <button
              type="button"
              className="text-sm text-muted-foreground"
              onClick={() => setPicked(null)}
            >
              Back to the list
            </button>
          </div>
        </article>
      )}
    </div>
  );
}
