'use client';

import { useState } from 'react';
import { Check, Copy, LoaderCircle, Send } from 'lucide-react';
import { Button } from '@ariforce/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@ariforce/ui/components/dialog';
import { toast } from '@ariforce/ui/components/sonner';
import { teamAdapter } from '@/lib/team-adapter/adapter';
import type { Employee, InviteResult } from '@/lib/team-adapter/types';
import type { Role } from '@/lib/roles';

const when = (iso: string) =>
  new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }).format(new Date(iso));

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older Safari / blocked clipboard: select-and-copy fallback.
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

function CopyButton({ text, label, testId }: { text: string; label: string; testId: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      data-testid={testId}
      onClick={async () => {
        if (await copy(text)) {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } else toast.error('Could not copy. Select the link and copy it.');
      }}
    >
      {done ? <Check aria-hidden /> : <Copy aria-hidden />} {done ? 'Copied' : label}
    </Button>
  );
}

/** One link (or the email-mode note) with copy and expiry. */
export function InviteLink({ r }: { r: InviteResult }) {
  if (!r.inviteUrl)
    return (
      <p className="text-sm text-muted-foreground" data-testid="invite-emailed">
        Invite sent to {r.name || 'them'} by email. It expires {when(r.expiresAt)}.
      </p>
    );
  return (
    <div className="grid gap-1.5" data-testid="invite-link">
      <div className="flex items-center gap-2">
        <input
          readOnly
          value={r.inviteUrl}
          onFocus={(e) => e.currentTarget.select()}
          aria-label={`Invite link for ${r.name}`}
          className="h-9 min-w-0 flex-1 rounded-md border bg-muted/40 px-2 font-mono text-xs"
          data-testid="invite-url"
        />
        <CopyButton text={r.inviteUrl} label="Copy" testId="invite-copy" />
      </div>
      <p className="text-xs text-muted-foreground" data-testid="invite-expiry">
        Single use. Expires {when(r.expiresAt)}. Sending a new invite cancels this link.
      </p>
    </div>
  );
}

/** Send / re-send one person's invite (employee sheet). */
export function InviteOne({ role, employee, sentBefore }: { role: Role; employee: Employee; sentBefore: boolean }) {
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<InviteResult | null>(null);
  return (
    <div className="grid gap-2 rounded-lg border p-3" data-testid="invite-box">
      <p className="text-sm">
        <span className="font-medium">No login yet.</span>{' '}
        <span className="text-muted-foreground">Send a link so {employee.name} can set a password.</span>
      </p>
      {res && <InviteLink r={res} />}
      <div>
        <Button
          type="button"
          size="sm"
          disabled={busy}
          data-testid="invite-send"
          onClick={async () => {
            setBusy(true);
            try {
              setRes(await teamAdapter.invite(role, employee.id));
            } catch (e) {
              toast.error(e instanceof Error ? e.message : 'Could not create the invite.');
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? <LoaderCircle className="animate-spin" aria-hidden /> : <Send aria-hidden />}
          {res || sentBefore ? 'Re-invite' : 'Send invite'}
        </Button>
      </div>
    </div>
  );
}

/** "Invite all pending": one request per person (the API has no bulk endpoint, CONTRACT-GAPS #26). */
export function InviteAll({ role, people, onClose }: { role: Role; people: Employee[]; onClose: () => void }) {
  const [rows, setRows] = useState<(InviteResult | { id: string; name: string; error: string })[] | null>(null);
  const [running, setRunning] = useState(false);
  const run = async () => {
    setRunning(true);
    const out: NonNullable<typeof rows> = [];
    for (const p of people) {
      try {
        out.push(await teamAdapter.invite(role, p.id));
      } catch (e) {
        out.push({ id: p.id, name: p.name, error: e instanceof Error ? e.message : 'Failed' });
      }
      setRows([...out]);
    }
    setRunning(false);
  };
  const links = (rows ?? []).filter((r): r is InviteResult => 'inviteUrl' in r && !!r.inviteUrl);
  return (
    <Dialog open onOpenChange={(o) => !o && !running && onClose()}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg" data-testid="invite-all-dialog">
        <DialogHeader>
          <DialogTitle>Invite everyone without a login</DialogTitle>
          <DialogDescription>
            {people.length} {people.length === 1 ? 'person' : 'people'} in your team. Each gets a new single-use link; older links stop working.
          </DialogDescription>
        </DialogHeader>
        {!rows ? (
          <ul className="grid gap-1 text-sm">
            {people.map((p) => <li key={p.id}>{p.name}</li>)}
          </ul>
        ) : (
          <ul className="grid gap-3" data-testid="invite-all-results">
            {rows.map((r) => (
              <li key={r.id} className="grid gap-1" data-testid="invite-all-row">
                <span className="text-sm font-medium">{r.name}</span>
                {'error' in r ? <span className="text-sm text-destructive">{r.error}</span> : <InviteLink r={r} />}
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          {links.length > 1 && !running && (
            <CopyButton text={links.map((l) => `${l.name}: ${l.inviteUrl}`).join('\n')} label="Copy all" testId="invite-copy-all" />
          )}
          {!rows && (
            <Button onClick={run} disabled={running || !people.length} data-testid="invite-all-confirm">
              <Send aria-hidden /> Create {people.length} {people.length === 1 ? 'link' : 'links'}
            </Button>
          )}
          {running && <LoaderCircle className="animate-spin text-muted-foreground" aria-label="Working" />}
        </div>
      </DialogContent>
    </Dialog>
  );
}
