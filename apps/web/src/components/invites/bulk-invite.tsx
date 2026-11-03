'use client';

import { useMemo, useState } from 'react';
import { LoaderCircle, Users } from 'lucide-react';
import { Badge } from '@ariforce/ui/components/badge';
import { Button } from '@ariforce/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@ariforce/ui/components/dialog';
import { Label } from '@ariforce/ui/components/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@ariforce/ui/components/select';
import { apiTeamAdapter } from '@/lib/team-adapter/adapter';
import type { BulkInviteResult, EmployeeInput, Hq } from '@/lib/team-adapter/types';
import { ROLE_LABEL, type Role, type SalesRole } from '@/lib/roles';
import { CopyButton, InviteLink } from './invite-links';

const EMAIL = /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/;

/** One person per line: "Name, email" or "Name, email, phone". */
export function parseBulk(text: string) {
  const ok: { name: string; email: string; phone: string }[] = [];
  const bad: { line: number; text: string }[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const t = raw.trim();
    if (!t) return;
    const [name = '', email = '', phone = ''] = t.split(/[,\t]/).map((x) => x.trim());
    if (!name || !EMAIL.test(email)) bad.push({ line: i + 1, text: t });
    else ok.push({ name, email, phone });
  });
  return { ok, bad };
}

const STATUS: Record<
  'invited' | 'skipped' | 'failed',
  { label: string; variant: 'default' | 'secondary' | 'destructive' }
> = {
  invited: { label: 'Invited', variant: 'default' },
  skipped: { label: 'Skipped', variant: 'secondary' },
  failed: { label: 'Failed', variant: 'destructive' },
};

/** "Add several": creates and invites new people via POST /v1/employees/invite-bulk (sent in chunks of 200). */
export function BulkInvite({
  role,
  managerId,
  hqs,
  onClose,
}: {
  role: Role;
  managerId: string;
  hqs: Hq[];
  onClose: (changed: boolean) => void;
}) {
  const roles = apiTeamAdapter.creatableRoles(role);
  const [newRole, setNewRole] = useState<SalesRole | ''>(roles[0] ?? '');
  const [hqId, setHqId] = useState(hqs[0]?.id ?? '');
  const [text, setText] = useState('');
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [res, setRes] = useState<BulkInviteResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const parsed = useMemo(() => parseBulk(text), [text]);

  const run = async () => {
    if (!newRole || !hqId || !parsed.ok.length || parsed.bad.length) return;
    setRunning(true);
    setErr(null);
    const inputs: EmployeeInput[] = parsed.ok.map((p) => ({
      ...p,
      role: newRole,
      hqId,
      managerId,
    }));
    try {
      setRes(await apiTeamAdapter.inviteBulk(role, inputs, setProgress));
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not send the invites.');
    }
    setRunning(false);
  };
  const links = (res?.rows ?? []).filter((r) => r.inviteUrl);

  return (
    <Dialog open onOpenChange={(o) => !o && !running && onClose(!!res?.summary.invited)}>
      <DialogContent
        className="max-h-[85dvh] overflow-y-auto sm:max-w-lg"
        data-testid="bulk-dialog"
      >
        <DialogHeader>
          <DialogTitle>Add several people</DialogTitle>
          <DialogDescription>
            Each person is added to your team and gets a single-use invite link.
          </DialogDescription>
        </DialogHeader>
        {!res ? (
          <div className="grid gap-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label>Role</Label>
                <Select value={newRole} onValueChange={(v) => setNewRole(v as SalesRole)}>
                  <SelectTrigger data-testid="bulk-role">
                    <SelectValue placeholder="Pick a role" />
                  </SelectTrigger>
                  <SelectContent>
                    {roles.map((r) => (
                      <SelectItem key={r} value={r}>
                        {ROLE_LABEL[r]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label>HQ</Label>
                <Select value={hqId} onValueChange={setHqId}>
                  <SelectTrigger data-testid="bulk-hq">
                    <SelectValue placeholder="Pick an HQ" />
                  </SelectTrigger>
                  <SelectContent>
                    {hqs.map((h) => (
                      <SelectItem key={h.id} value={h.id}>
                        {h.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="bulk-text">People, one per line</Label>
              <textarea
                id="bulk-text"
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={6}
                placeholder={
                  'Asha Rao, asha@example.com\nVikram Shah, vikram@example.com, 9876543210'
                }
                className="w-full rounded-md border bg-background px-3 py-2 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring md:text-sm"
                data-testid="bulk-text"
              />
              <p className="text-xs text-muted-foreground" data-testid="bulk-count">
                Name, email, and optionally phone. {parsed.ok.length}{' '}
                {parsed.ok.length === 1 ? 'person' : 'people'} ready
                {parsed.ok.length > 200
                  ? ` (sent in ${Math.ceil(parsed.ok.length / 200)} batches)`
                  : ''}
                .
              </p>
              {parsed.bad.length > 0 && (
                <p role="alert" className="text-sm text-destructive" data-testid="bulk-bad">
                  Fix line {parsed.bad.map((b) => b.line).join(', ')}: each line needs a name and a
                  valid email.
                </p>
              )}
            </div>
            {err && (
              <p role="alert" className="text-sm text-destructive" data-testid="bulk-error">
                {err}
              </p>
            )}
            <div className="flex items-center justify-end gap-2">
              {running && (
                <span className="text-sm text-muted-foreground">
                  {progress} of {parsed.ok.length}
                </span>
              )}
              <Button
                onClick={run}
                disabled={
                  running || !parsed.ok.length || parsed.bad.length > 0 || !newRole || !hqId
                }
                data-testid="bulk-confirm"
              >
                {running ? (
                  <LoaderCircle className="animate-spin" aria-hidden />
                ) : (
                  <Users aria-hidden />
                )}{' '}
                Add and invite {parsed.ok.length || ''}
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid gap-3">
            <p className="text-sm" data-testid="bulk-summary">
              {res.summary.invited} invited · {res.summary.skipped} skipped · {res.summary.failed}{' '}
              failed
            </p>
            <ul className="grid gap-3" data-testid="bulk-results">
              {res.rows.map((r) => (
                <li
                  key={r.index}
                  className="grid gap-1"
                  data-testid="bulk-row"
                  data-status={r.status}
                >
                  <span className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-medium">{r.name}</span>
                    <span className="text-muted-foreground">{r.email}</span>
                    <Badge variant={STATUS[r.status].variant}>{STATUS[r.status].label}</Badge>
                  </span>
                  {r.status !== 'invited' && r.message && (
                    <span className="text-sm text-muted-foreground">{r.message}</span>
                  )}
                  {r.status === 'invited' && !r.inviteUrl && (
                    <span className="text-sm text-muted-foreground">Invite sent by email.</span>
                  )}
                  {r.inviteUrl && (
                    <InviteLink
                      r={{
                        id: String(r.index),
                        name: r.name,
                        expiresAt: '',
                        inviteUrl: r.inviteUrl,
                      }}
                    />
                  )}
                </li>
              ))}
            </ul>
            <div className="flex justify-end gap-2">
              {links.length > 1 && (
                <CopyButton
                  text={links.map((l) => `${l.name}: ${l.inviteUrl}`).join('\n')}
                  label="Copy all"
                  testId="bulk-copy-all"
                />
              )}
              <Button
                variant="outline"
                onClick={() => onClose(!!res.summary.invited)}
                data-testid="bulk-done"
              >
                Done
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
