'use client';

import { useState } from 'react';
import Link from 'next/link';
import { REAL } from '@/lib/api';
import { Button } from '@ariforce/ui/components/button';
import { Input } from '@ariforce/ui/components/input';
import { Label } from '@ariforce/ui/components/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@ariforce/ui/components/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@ariforce/ui/components/sheet';
import { toast } from '@ariforce/ui/components/sonner';
import { ROLE_LABEL, ROLE_SHORT, roleLevel, type Role, type SalesRole } from '@/lib/roles';
import { InviteOne } from '@/components/invites/invite-links';
import { teamAdapter } from '@/lib/team-adapter/adapter';
import { AdapterError, type Employee, type EmployeeInput, type Hq } from '@/lib/team-adapter/types';

export type SheetState = { mode: 'add' } | { mode: 'edit'; employee: Employee } | null;

type Props = {
  state: SheetState;
  onClose: () => void;
  onDone: (msg: string) => void;
  role: Role;
  rootId: string;
  managers: Employee[];
  hqs: Hq[];
};

export function EmployeeSheet(props: Props) {
  const key = props.state ? (props.state.mode === 'add' ? 'add' : props.state.employee.id) : 'none';
  return (
    <Sheet open={!!props.state} onOpenChange={(o) => !o && props.onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md" data-testid="employee-sheet">
        {props.state && <Form key={key} {...props} state={props.state} />}
      </SheetContent>
    </Sheet>
  );
}

function Form({
  state,
  onDone,
  role,
  rootId,
  managers,
  hqs,
}: Props & { state: NonNullable<SheetState> }) {
  const edit = state.mode === 'edit' ? state.employee : null;
  const self = edit?.id === rootId;
  const roles = teamAdapter.creatableRoles(role);
  const [v, setV] = useState<EmployeeInput>({
    name: edit?.name ?? '',
    phone: edit?.phone ?? '',
    email: edit?.email ?? '',
    role: edit?.role ?? roles[0]!,
    hqId: edit?.hqId ?? null,
    managerId: edit?.managerId ?? null,
  });
  const [err, setErr] = useState<{ field?: string; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof EmployeeInput>(k: K, x: EmployeeInput[K]) =>
    setV((p) => ({ ...p, [k]: x }));
  const managerOptions = managers.filter(
    (m) => roleLevel(m.role) > roleLevel(v.role) && m.id !== edit?.id,
  );

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      if (edit) {
        await teamAdapter.update(role, edit.id, v);
        onDone(`${v.name} updated.`);
      } else {
        await teamAdapter.create(role, v);
        onDone(`${v.name} added to your team.`);
      }
    } catch (e) {
      setErr(
        e instanceof AdapterError
          ? { field: e.field, message: e.message }
          : { message: 'Could not save.' },
      );
    } finally {
      setBusy(false);
    }
  };
  const setActive = async (active: boolean) => {
    try {
      await teamAdapter.update(role, edit!.id, { active });
      onDone(`${edit!.name} ${active ? 'reactivated' : 'deactivated'}.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save.');
    }
  };
  const fieldErr = (f: string) =>
    err?.field === f ? (
      <p className="text-xs text-destructive" id={`${f}-err`}>
        {err.message}
      </p>
    ) : null;

  return (
    <form onSubmit={submit} className="flex h-full flex-col" noValidate>
      <SheetHeader>
        <SheetTitle>{edit ? edit.name : 'Add employee'}</SheetTitle>
        <SheetDescription>
          {edit
            ? `${ROLE_LABEL[edit.role]} · ${edit.employeeCode}`
            : 'They join your team. The employee code is assigned on save.'}
        </SheetDescription>
      </SheetHeader>
      {self ? (
        <p className="px-4 text-sm text-muted-foreground">
          This is you. Ask your own manager to change your record.
        </p>
      ) : (
        <div className="flex flex-col gap-4 px-4">
          <Field id="name" label="Name" err={fieldErr('name')}>
            <Input
              id="name"
              value={v.name}
              onChange={(e) => set('name', e.target.value)}
              autoComplete="off"
              aria-invalid={err?.field === 'name' || undefined}
            />
          </Field>
          <Field id="phone" label="Phone" err={fieldErr('phone')}>
            <Input
              id="phone"
              type="tel"
              inputMode="tel"
              value={v.phone}
              onChange={(e) => set('phone', e.target.value)}
              aria-invalid={err?.field === 'phone' || undefined}
            />
          </Field>
          <Field id="email" label="Work email" err={fieldErr('email')}>
            <Input
              id="email"
              type="email"
              value={v.email}
              onChange={(e) => set('email', e.target.value)}
              aria-invalid={err?.field === 'email' || undefined}
            />
          </Field>
          <Field id="role" label="Role" err={fieldErr('role')}>
            <Select value={v.role} onValueChange={(x) => set('role', x as SalesRole)}>
              <SelectTrigger id="role" className="w-full" data-testid="role-select">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(edit && !roles.includes(edit.role) ? [edit.role, ...roles] : roles).map((r) => (
                  <SelectItem key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field id="hq" label="HQ" err={fieldErr('hqId')}>
            <Select value={v.hqId ?? ''} onValueChange={(x) => set('hqId', x)}>
              <SelectTrigger id="hq" className="w-full" data-testid="hq-select">
                <SelectValue placeholder="Pick an HQ" />
              </SelectTrigger>
              <SelectContent>
                {hqs.map((h) => (
                  <SelectItem key={h.id} value={h.id}>
                    {h.name} · {h.city}, {h.state}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field id="manager" label="Reports to" err={fieldErr('managerId')}>
            <Select value={v.managerId ?? ''} onValueChange={(x) => set('managerId', x)}>
              <SelectTrigger id="manager" className="w-full" data-testid="manager-select">
                <SelectValue placeholder="Pick a manager" />
              </SelectTrigger>
              <SelectContent>
                {managerOptions.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.name} ({ROLE_SHORT[m.role]})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {err && !err.field && (
            <p role="alert" className="text-sm text-destructive">
              {err.message}
            </p>
          )}
        </div>
      )}
      {edit && REAL && (
        <Button asChild size="sm" className="w-fit">
          <Link href={`/team/members/${edit.id}`} data-testid="sheet-profile">
            View full profile
          </Link>
        </Button>
      )}
      {edit?.invited && !self && <InviteOne role={role} employee={edit} sentBefore={false} />}
      {!self && (
        <SheetFooter className="mt-auto flex-row flex-wrap justify-between gap-2">
          {edit ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => setActive(!edit.active)}
              data-testid={edit.active ? 'deactivate' : 'reactivate'}
            >
              {edit.active ? 'Deactivate' : 'Reactivate'}
            </Button>
          ) : (
            <span />
          )}
          <Button type="submit" disabled={busy} data-testid="save-employee">
            {busy ? 'Saving…' : edit ? 'Save changes' : 'Add employee'}
          </Button>
        </SheetFooter>
      )}
    </form>
  );
}

function Field({
  id,
  label,
  err,
  children,
}: {
  id: string;
  label: string;
  err: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {err}
    </div>
  );
}
