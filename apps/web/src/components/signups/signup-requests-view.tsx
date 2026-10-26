'use client';

import { useCallback, useEffect, useId, useState } from 'react';
import { LoaderCircle, Search, UserPlus } from 'lucide-react';
import { Button } from '@ariforce/ui/components/button';
import { Input } from '@ariforce/ui/components/input';
import { Label } from '@ariforce/ui/components/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@ariforce/ui/components/dialog';
import { toast } from '@ariforce/ui/components/sonner';
import { useSession } from '@/lib/mock-auth';
import { ROLE_LABEL, isSystemAdmin, roleLevel, type Role } from '@/lib/roles';
import {
  SignUpError,
  reviewableRoles,
  signupAdapter,
  type SignUpRequest,
} from '@/lib/signup/adapter';
import { teamAdapter } from '@/lib/team-adapter/adapter';
import type { Employee, Hq } from '@/lib/team-adapter/types';

const SELECT =
  'h-10 w-full rounded-md border border-input bg-transparent px-3 text-base shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 md:text-sm';
const LIMIT = 20;
const fmt = (iso: string) =>
  new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; items: SignUpRequest[]; total: number; next: string | null };
type Done = (r: SignUpRequest, verb: string) => void;

export function SignupRequestsView() {
  const session = useSession();
  const role = session?.role as Role | undefined;
  const [q, setQ] = useState('');
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [more, setMore] = useState(false);
  const [acting, setActing] = useState<{ req: SignUpRequest; kind: 'approve' | 'reject' } | null>(
    null,
  );

  const load = useCallback(
    async (cursor?: string | null) => {
      if (!role) return;
      if (!cursor) setState({ kind: 'loading' });
      else setMore(true);
      try {
        const p = await signupAdapter.list(role, { q, cursor, limit: LIMIT });
        setState((s) =>
          cursor && s.kind === 'ready'
            ? { kind: 'ready', items: [...s.items, ...p.items], total: p.total, next: p.nextCursor }
            : { kind: 'ready', items: p.items, total: p.total, next: p.nextCursor },
        );
      } catch (e) {
        setState({
          kind: 'error',
          message: e instanceof SignUpError ? e.message : 'Could not load requests.',
        });
      } finally {
        setMore(false);
      }
    },
    [role, q],
  );

  useEffect(() => {
    const t = setTimeout(() => void load(), q ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  const done: Done = (r, verb) => {
    setActing(null);
    toast.success(`${r.name}: ${verb}.`);
    setState((s) =>
      s.kind === 'ready'
        ? { ...s, items: s.items.filter((i) => i.id !== r.id), total: Math.max(0, s.total - 1) }
        : s,
    );
  };

  if (!role) return null;
  return (
    <>
      <div className="relative max-w-sm">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name, email or phone"
          aria-label="Search requests"
          className="h-10 pl-9"
        />
      </div>

      {state.kind === 'loading' && (
        <div className="grid gap-2" aria-busy="true" data-testid="signups-loading">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-[72px] animate-pulse rounded-lg border bg-muted/40 motion-reduce:animate-none"
            />
          ))}
        </div>
      )}

      {state.kind === 'error' && (
        <div role="alert" data-testid="signups-error" className="rounded-lg border p-6 text-center">
          <p className="text-sm">{state.message}</p>
          <Button variant="outline" className="mt-3" onClick={() => void load()}>
            Try again
          </Button>
        </div>
      )}

      {state.kind === 'ready' && state.items.length === 0 && (
        <div
          data-testid="signups-empty"
          className="rounded-lg border border-dashed p-10 text-center"
        >
          <UserPlus className="mx-auto size-6 text-muted-foreground" aria-hidden />
          <p className="mt-2 font-medium">{q ? 'No matching requests' : 'No pending requests'}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            New requests from the sign-up page show up here.
          </p>
        </div>
      )}

      {state.kind === 'ready' && state.items.length > 0 && (
        <>
          <p className="text-sm text-muted-foreground" data-testid="signups-total">
            {state.total} pending
          </p>
          <ul className="grid gap-2" data-testid="signups-list">
            {state.items.map((r) => (
              <li
                key={r.id}
                data-testid="signup-row"
                className="flex flex-col gap-3 rounded-lg border bg-card p-4 sm:flex-row sm:items-center"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{r.name}</p>
                  <p className="truncate text-sm text-muted-foreground">
                    {r.email} · <span className="tabular-nums">{r.phone}</span>
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Asked for {ROLE_LABEL[r.role]} · {fmt(r.createdAt)}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    className="flex-1 sm:flex-none"
                    onClick={() => setActing({ req: r, kind: 'reject' })}
                  >
                    Reject
                  </Button>
                  <Button
                    className="flex-1 sm:flex-none"
                    onClick={() => setActing({ req: r, kind: 'approve' })}
                  >
                    Approve
                  </Button>
                </div>
              </li>
            ))}
          </ul>
          {state.next && (
            <Button variant="outline" onClick={() => void load(state.next)} disabled={more}>
              {more && <LoaderCircle className="animate-spin motion-reduce:animate-none" />}
              Load more
            </Button>
          )}
        </>
      )}

      {acting?.kind === 'approve' && (
        <ApproveDialog
          viewer={role}
          req={acting.req}
          onClose={() => setActing(null)}
          onDone={done}
        />
      )}
      {acting?.kind === 'reject' && (
        <RejectDialog req={acting.req} onClose={() => setActing(null)} onDone={done} />
      )}
    </>
  );
}

function useDecide(onDone: Done) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<SignUpRequest>, verb: string) => {
    setBusy(true);
    setError(null);
    try {
      onDone(await fn(), verb);
    } catch (e) {
      setError(e instanceof SignUpError ? e.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
}

function Footer({
  busy,
  onClose,
  children,
}: {
  busy: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <DialogFooter>
      <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
        Cancel
      </Button>
      {children}
    </DialogFooter>
  );
}

function ApproveDialog({
  viewer,
  req,
  onClose,
  onDone,
}: {
  viewer: Role;
  req: SignUpRequest;
  onClose: () => void;
  onDone: Done;
}) {
  const id = useId();
  const roles = reviewableRoles(viewer);
  const [role, setRole] = useState<Role>(roles.includes(req.role) ? req.role : roles[0]!);
  const [hqId, setHq] = useState(req.hqId ?? '');
  const [managerId, setManager] = useState('');
  const [hqs, setHqs] = useState<Hq[]>([]);
  const [people, setPeople] = useState<Employee[]>([]);
  const { busy, error, run } = useDecide(onDone);

  useEffect(() => {
    let live = true;
    const all = (teamAdapter as { allHqs?: () => Hq[] }).allHqs;
    void Promise.allSettled([
      isSystemAdmin(viewer) && all ? Promise.resolve(all()) : teamAdapter.hqs(viewer),
      teamAdapter.tree(viewer),
    ]).then(([h, t]) => {
      if (!live) return;
      if (h.status === 'fulfilled') setHqs(h.value);
      if (t.status === 'fulfilled') setPeople(t.value.nodes);
    });
    return () => {
      live = false;
    };
  }, [viewer]);

  const lvl = roleLevel(role);
  const managers = people.filter((p) => p.active && (lvl === 0 || roleLevel(p.role as Role) > lvl));
  const needsManager = lvl > 0 && role !== 'director';

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent data-testid="approve-dialog">
        <DialogHeader>
          <DialogTitle>Approve {req.name}?</DialogTitle>
          <DialogDescription>
            They can sign in as soon as you approve. {req.email}
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void run(
              () =>
                signupAdapter.decide(req.id, {
                  approve: true,
                  d: { role, hqId: hqId || null, managerId: managerId || null },
                }),
              'approved',
            );
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-role`}>Role</Label>
            <select
              id={`${id}-role`}
              value={role}
              onChange={(e) => setRole(e.target.value as Role)}
              className={SELECT}
            >
              {roles.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-hq`}>HQ</Label>
            <select
              id={`${id}-hq`}
              value={hqId}
              onChange={(e) => setHq(e.target.value)}
              className={SELECT}
            >
              <option value="">No HQ yet</option>
              {hqs.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
            </select>
          </div>
          {needsManager && (
            <div className="grid gap-1.5">
              <Label htmlFor={`${id}-mgr`}>Reports to</Label>
              <select
                id={`${id}-mgr`}
                value={managerId}
                onChange={(e) => setManager(e.target.value)}
                className={SELECT}
              >
                <option value="">Assign later (Unassigned)</option>
                {managers.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}, {ROLE_LABEL[m.role as Role]}
                  </option>
                ))}
              </select>
            </div>
          )}
          {error && (
            <p role="alert" className="text-[13px] text-destructive" data-testid="decide-error">
              {error}
            </p>
          )}
          <Footer busy={busy} onClose={onClose}>
            <Button type="submit" disabled={busy} data-testid="confirm-approve">
              {busy && <LoaderCircle className="animate-spin motion-reduce:animate-none" />}
              Approve as {ROLE_LABEL[role]}
            </Button>
          </Footer>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RejectDialog({
  req,
  onClose,
  onDone,
}: {
  req: SignUpRequest;
  onClose: () => void;
  onDone: Done;
}) {
  const id = useId();
  const [reason, setReason] = useState('');
  const { busy, error, run } = useDecide(onDone);
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent data-testid="reject-dialog">
        <DialogHeader>
          <DialogTitle>Reject {req.name}?</DialogTitle>
          <DialogDescription>They will see that the request was not approved.</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => signupAdapter.decide(req.id, { approve: false, reason }), 'rejected');
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-reason`}>
              Reason <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <textarea
              id={`${id}-reason`}
              value={reason}
              maxLength={300}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 md:text-sm"
            />
          </div>
          {error && (
            <p role="alert" className="text-[13px] text-destructive" data-testid="decide-error">
              {error}
            </p>
          )}
          <Footer busy={busy} onClose={onClose}>
            <Button
              type="submit"
              variant="destructive"
              disabled={busy}
              data-testid="confirm-reject"
            >
              {busy && <LoaderCircle className="animate-spin motion-reduce:animate-none" />}
              Reject request
            </Button>
          </Footer>
        </form>
      </DialogContent>
    </Dialog>
  );
}
