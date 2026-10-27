'use client';

import { useCallback, useEffect, useId, useState } from 'react';
import { LoaderCircle, UserPlus } from 'lucide-react';
import { Button } from '@ariforce/ui/components/button';
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
import { api, apiReady } from '@/lib/api';
import { useSession } from '@/lib/mock-auth';
import { ROLE_LABEL, roleLevel, type Role } from '@/lib/roles';
import {
  SignupError,
  grantableRoles,
  needsTerritory,
  signupAdapter,
  takesManager,
  type SignupRequest,
  type SignupStatus,
} from '@/lib/signup/adapter';
import { teamAdapter } from '@/lib/team-adapter/adapter';
import type { Employee } from '@/lib/team-adapter/types';

const SELECT =
  'h-10 w-full rounded-md border border-input bg-transparent px-3 text-base shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 md:text-sm';
const TABS: { id: SignupStatus; label: string }[] = [
  { id: 'pending', label: 'Pending' },
  { id: 'approved', label: 'Approved' },
  { id: 'rejected', label: 'Rejected' },
];
const fmt = (iso: string) =>
  new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; items: SignupRequest[] };
type Done = (r: SignupRequest, verb: string) => void;

export function SignupRequestsView() {
  const session = useSession();
  const role = session?.role as Role | undefined;
  const [tab, setTab] = useState<SignupStatus>('pending');
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [acting, setActing] = useState<{ req: SignupRequest; kind: 'approve' | 'reject' } | null>(
    null,
  );

  // The contract returns the whole list for one status ({ items }): no q or cursor (CONTRACT-GAPS #23).
  const load = useCallback(async () => {
    if (!role) return;
    setState({ kind: 'loading' });
    try {
      setState({ kind: 'ready', items: await signupAdapter.list(role, tab) });
    } catch (e) {
      setState({
        kind: 'error',
        message: e instanceof SignupError ? e.message : 'Could not load requests.',
      });
    }
  }, [role, tab]);

  useEffect(() => {
    void load();
  }, [load]);

  const done: Done = (r, verb) => {
    setActing(null);
    toast.success(`${r.name}: ${verb}.`);
    setState((s) =>
      s.kind === 'ready' ? { ...s, items: s.items.filter((i) => i.id !== r.id) } : s,
    );
  };

  if (!role) return null;
  return (
    <>
      <div role="tablist" aria-label="Request status" className="flex gap-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            type="button"
            aria-selected={tab === t.id}
            data-testid={`signups-tab-${t.id}`}
            onClick={() => setTab(t.id)}
            className={`h-9 rounded-md px-3 text-sm font-medium transition-colors ${tab === t.id ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
          >
            {t.label}
          </button>
        ))}
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
          <p className="mt-2 font-medium">No {tab} requests</p>
          <p className="mt-1 text-sm text-muted-foreground">
            New requests from the sign-up page show up under Pending.
          </p>
        </div>
      )}

      {state.kind === 'ready' && state.items.length > 0 && (
        <>
          <p className="text-sm text-muted-foreground" data-testid="signups-total">
            {state.items.length} {tab}
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
                    {r.email}
                    {r.phone && (
                      <>
                        {' · '}
                        <span className="tabular-nums">{r.phone}</span>
                      </>
                    )}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Asked for {ROLE_LABEL[r.requestedRole]} · {fmt(r.createdAt)}
                    {r.status === 'approved' &&
                      r.approvedRole &&
                      ` · Approved as ${ROLE_LABEL[r.approvedRole]}`}
                    {r.status === 'rejected' && r.reason && ` · ${r.reason}`}
                    {r.status === 'pending' && !r.requestedManagerId && ' · No manager chosen'}
                  </p>
                </div>
                {r.status === 'pending' && (
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
                )}
              </li>
            ))}
          </ul>
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
  const run = async (fn: () => Promise<SignupRequest>, verb: string) => {
    setBusy(true);
    setError(null);
    try {
      onDone(await fn(), verb);
    } catch (e) {
      setError(e instanceof SignupError ? e.message : 'Something went wrong. Try again.');
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
  req: SignupRequest;
  onClose: () => void;
  onDone: Done;
}) {
  const id = useId();
  const roles = grantableRoles(viewer);
  const [role, setRole] = useState<Role>(
    roles.includes(req.requestedRole) ? req.requestedRole : roles[0]!,
  );
  const [territoryIds, setTerritoryIds] = useState<string[]>(
    req.requestedTerritoryId ? [req.requestedTerritoryId] : [],
  );
  const [managerId, setManager] = useState('');
  const [territories, setTerritories] = useState<{ id: string; name: string }[] | null>(null);
  const [people, setPeople] = useState<Employee[]>([]);
  const [localError, setLocalError] = useState<string | null>(null);
  const { busy, error, run } = useDecide(onDone);

  useEffect(() => {
    let live = true;
    void apiReady()
      .then(() => api.GET('/v1/territories', { params: { query: { limit: 200 } } }))
      .then((r) => {
        if (live) setTerritories((r.data?.items ?? []).map((t) => ({ id: t.id, name: t.name })));
      })
      .catch(() => live && setTerritories([]));
    void teamAdapter
      .tree(viewer)
      .then((t) => live && setPeople(t.nodes))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [viewer]);

  const lvl = roleLevel(role);
  const managers = people.filter((p) => p.active && roleLevel(p.role as Role) > lvl);
  const withManager = takesManager(role);
  const withTerritory = needsTerritory(role);
  // The requested HQ is pre-ticked only if it is one this approver can assign (and so can see and untick).
  const chosen = territoryIds.filter((id) => territories?.some((t) => t.id === id));

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
            if (withTerritory && chosen.length === 0)
              return setLocalError('Pick at least one territory for this role.');
            setLocalError(null);
            void run(
              () =>
                signupAdapter.approve(req.id, {
                  role: role as never,
                  ...(withTerritory ? { territoryIds: chosen } : {}),
                  // Director, Distribution Head and Accountant take no manager.
                  ...(withManager && managerId ? { managerId } : {}),
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
          {withTerritory && (
            <fieldset className="grid gap-1.5">
              <legend className="mb-1.5 text-sm font-medium">Territories</legend>
              {territories === null ? (
                <p className="text-sm text-muted-foreground">Loading territories…</p>
              ) : territories.length === 0 ? (
                <p className="text-sm text-destructive">No territories you can assign.</p>
              ) : (
                <div
                  className="grid max-h-40 gap-1 overflow-y-auto rounded-md border p-2"
                  data-testid="territory-picker"
                >
                  {territories.map((t) => (
                    <label key={t.id} className="flex min-h-8 items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={territoryIds.includes(t.id)}
                        onChange={(e) =>
                          setTerritoryIds((ids) =>
                            e.target.checked ? [...ids, t.id] : ids.filter((x) => x !== t.id),
                          )
                        }
                        className="size-4"
                      />
                      {t.name}
                    </label>
                  ))}
                </div>
              )}
            </fieldset>
          )}
          {withManager ? (
            <div className="grid gap-1.5">
              <Label htmlFor={`${id}-mgr`}>Reports to</Label>
              <select
                id={`${id}-mgr`}
                value={managerId}
                onChange={(e) => setManager(e.target.value)}
                className={SELECT}
              >
                <option value="">
                  {req.requestedManagerId ? 'Keep requested manager' : 'Me (default)'}
                </option>
                {managers.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}, {ROLE_LABEL[m.role as Role]}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <p className="text-[13px] text-muted-foreground" data-testid="no-manager-note">
              {ROLE_LABEL[role]} has no reporting manager.
            </p>
          )}
          {(localError ?? error) && (
            <p role="alert" className="text-[13px] text-destructive" data-testid="decide-error">
              {localError ?? error}
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
  req: SignupRequest;
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
            void run(() => signupAdapter.reject(req.id, reason), 'rejected');
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
