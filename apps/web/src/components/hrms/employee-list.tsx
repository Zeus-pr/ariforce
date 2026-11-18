'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { listPeople, type Person } from '@/lib/people/adapter';
import { ROLE_LABEL, roleLabel, type Role } from '@/lib/roles';
import { Button } from '@ariforce/ui/components/button';
import { Input } from '@ariforce/ui/components/input';

const STATUS: Record<Person['status'], string> = {
  invited: 'Invited',
  active: 'Active',
  suspended: 'Suspended',
  pending: 'Pending',
  rejected: 'Rejected',
};

export function EmployeeList() {
  const [people, setPeople] = useState<Person[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');

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
        if (live) setError(e instanceof Error ? e.message : 'Could not load employees.');
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const rows = people ?? [];
    if (!needle) return rows;
    return rows.filter((p) =>
      [p.name, p.email, p.employeeCode, p.designation, p.phone]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(needle)),
    );
  }, [people, q]);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-semibold">People</h1>
        <div className="ml-auto flex items-center gap-2">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name, code, or email"
            aria-label="Search employees"
            className="h-9 w-64"
          />
          <Button asChild>
            <Link href="/hr/employees/new">New employee</Link>
          </Button>
        </div>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {people === null && !error && (
        <p className="text-sm text-muted-foreground">Loading employees…</p>
      )}
      {people && (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Employees</caption>
            <thead className="border-b bg-muted/40 text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">Code</th>
                <th className="px-3 py-2 font-medium">Designation</th>
                <th className="px-3 py-2 font-medium">Role</th>
                <th className="px-3 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((p) => (
                <tr key={p.id} className="border-b last:border-0">
                  <td className="px-3 py-2">
                    <Link href={`/hr/employees/${p.id}`} className="font-medium text-primary">
                      {p.name}
                    </Link>
                    <span className="block text-xs text-muted-foreground">{p.email}</span>
                  </td>
                  <td className="px-3 py-2">{p.employeeCode ?? '—'}</td>
                  <td className="px-3 py-2">{p.designation ?? '—'}</td>
                  <td className="px-3 py-2">
                    {p.primaryRole ? ROLE_LABEL[p.primaryRole as Role] : roleLabel(p.roles[0])}
                  </td>
                  <td className="px-3 py-2">{STATUS[p.status]}</td>
                </tr>
              ))}
              {shown.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-muted-foreground">
                    No employees match.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
