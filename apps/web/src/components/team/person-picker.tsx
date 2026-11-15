'use client';

import { SearchSelect, type SelectOption } from '@/components/dcr/search-select';
import { useRole } from '@/components/shell/role-context';
import { ROLE_SHORT } from '@/lib/roles';
import { useTeamPeople } from '@/lib/team/people';

/** '' means everyone the user can see. */
export const EVERYONE = '';

/**
 * Searchable person filter over the people the role may see (the existing SearchSelect). Lists
 * "Everyone" (when allowed), then you, then everyone else by name.
 */
export function PersonPicker({
  value,
  onChange,
  allowEveryone = true,
  testId = 'person-picker',
}: {
  value: string;
  onChange: (id: string) => void;
  allowEveryone?: boolean;
  testId?: string;
}) {
  const { role, user } = useRole();
  const q = useTeamPeople(role);
  const me = user?.id ?? '';
  const others = (q.data?.people ?? [])
    .filter((p) => p.id !== me)
    .sort((a, b) => a.name.localeCompare(b.name));
  const options: SelectOption[] = [
    ...(allowEveryone ? [{ id: 'all', label: 'Everyone' }] : []),
    ...(me ? [{ id: me, label: 'Me' }] : []),
    ...others.map((p) => ({
      id: p.id,
      label: p.name,
      hint: [ROLE_SHORT[p.role], p.employeeCode].filter(Boolean).join(' · ') || null,
    })),
  ];
  return (
    <SearchSelect
      label="Person"
      options={options}
      value={[value === EVERYONE ? 'all' : value]}
      onChange={(ids) => {
        const id = ids[ids.length - 1];
        if (id) onChange(id === 'all' ? EVERYONE : id);
      }}
      loading={q.isLoading}
      error={q.error ? 'Could not load your team.' : null}
      onRetry={() => void q.refetch()}
      emptyText="No one found."
      testId={testId}
    />
  );
}
