'use client';

import { useEffect, useRef, useId, useState } from 'react';
import Link from 'next/link';
import { CircleCheck, Eye, EyeOff, LinkIcon, LoaderCircle } from 'lucide-react';
import { Button } from '@ariforce/ui/components/button';
import { Input } from '@ariforce/ui/components/input';
import { Label } from '@ariforce/ui/components/label';
import { api, apiReady, toApiError } from '@/lib/api';
import {
  PASSWORD_MAX,
  PASSWORD_MIN,
  PASSWORD_PATTERN,
  passwordAccepted,
  passwordRuleMessage,
} from '@ariforce/contracts';
import { PasswordRules } from '@/components/auth/password-rules';
import { authLimitMessage } from '@/lib/auth-errors';

type Dead = 'missing' | 'invalid' | 'used' | 'expired';
type State = 'reading' | 'form' | 'done' | Dead;

const DEAD: Record<Dead, { title: string; body: string }> = {
  missing: {
    title: 'This link is incomplete',
    body: 'Open the full link your manager sent you, or ask them to copy it again.',
  },
  invalid: {
    title: 'This invite link is not valid',
    body: 'It may have been replaced by a newer invite. Ask your manager to send a new one.',
  },
  used: {
    title: 'This invite was already used',
    body: 'Your password is already set. Sign in with your work email, or ask your manager if you cannot get in.',
  },
  expired: {
    title: 'This invite has expired',
    body: 'Invite links last 7 days. Ask your manager to send a new one.',
  },
};

/**
 * POST /v1/invites/accept. The token is read once from ?token=, kept only in memory, and removed from
 * the address bar and history right away; the password is never stored or logged.
 */
export function AcceptInviteForm() {
  const id = useId();
  const [token, setToken] = useState<string | null>(null);
  const [state, setState] = useState<State>('reading');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);

  const read = useRef(false);
  useEffect(() => {
    if (read.current) return;
    read.current = true;
    const t = new URLSearchParams(window.location.search).get('token');
    if (window.location.search) window.history.replaceState(null, '', window.location.pathname);
    if (t && t.length >= 20 && t.length <= 200) {
      setToken(t);
      setState('form');
    } else setState(t ? 'invalid' : 'missing');
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passwordAccepted(pw)) return setErr(passwordRuleMessage(pw));
    if (pw !== pw2) return setErr('The two passwords do not match.');
    setErr(null);
    setBusy(true);
    await apiReady();
    const r = await api
      .POST('/v1/invites/accept', { body: { token: token!, password: pw } })
      .catch(() => null);
    setBusy(false);
    if (r?.data) {
      setPw('');
      setPw2('');
      setToken(null);
      setEmail(r.data.email);
      return setState('done');
    }
    const code = r ? toApiError(r).code : 'NETWORK';
    const status = r?.response.status;
    const dead: Dead | null =
      code === 'INVITE_USED' || status === 409
        ? 'used'
        : code === 'INVITE_EXPIRED' || status === 410
          ? 'expired'
          : code === 'INVITE_INVALID' || status === 404
            ? 'invalid'
            : null;
    if (dead) {
      setToken(null);
      setPw('');
      setPw2('');
      return setState(dead);
    }
    const limit = authLimitMessage(r);
    if (limit) return setErr(limit);
    if (status === 422)
      return setErr(
        r
          ? toApiError(r).message ||
              passwordRuleMessage(pw) ||
              'Choose a password that meets every requirement.'
          : '',
      );
    setErr('Could not reach the server. Check your connection and try again.');
  };

  if (state === 'reading') return <div className="h-64" aria-busy="true" />;
  if (state in DEAD)
    return (
      <div
        className="grid gap-3 rounded-xl border bg-background p-5 text-sm shadow-xs"
        data-testid={`invite-${state}`}
      >
        <p className="flex items-center gap-2 font-medium">
          <LinkIcon className="size-4" aria-hidden />
          {DEAD[state as Dead].title}
        </p>
        <p className="text-muted-foreground">{DEAD[state as Dead].body}</p>
        <Button asChild variant="outline">
          <Link href="/sign-in">Go to sign in</Link>
        </Button>
      </div>
    );
  if (state === 'done')
    return (
      <div
        className="grid gap-3 rounded-xl border bg-background p-5 text-sm shadow-xs"
        data-testid="invite-done"
      >
        <p className="flex items-center gap-2 font-medium">
          <CircleCheck className="size-4 text-success" aria-hidden /> Password set
        </p>
        <p className="text-muted-foreground">
          Sign in with {email ?? 'your work email'} and the password you just chose.
        </p>
        <Button asChild>
          <Link
            href={`/sign-in${email ? `?email=${encodeURIComponent(email)}` : ''}`}
            data-testid="invite-to-sign-in"
          >
            Sign in
          </Link>
        </Button>
      </div>
    );
  return (
    <form
      onSubmit={submit}
      noValidate
      className="grid gap-4 rounded-xl border bg-background p-5 shadow-xs"
      data-testid="invite-form"
    >
      <input type="text" name="username" autoComplete="username" hidden readOnly value="" />
      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-pw`}>New password</Label>
        <PasswordRules password={pw} id={`${id}-rules`} />
        <div className="relative">
          <Input
            id={`${id}-pw`}
            type={show ? 'text' : 'password'}
            autoComplete="new-password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            aria-describedby={`${id}-rules`}
            minLength={PASSWORD_MIN}
            maxLength={PASSWORD_MAX}
            pattern={PASSWORD_PATTERN}
            className="h-10 pr-10 text-base md:text-base"
            data-testid="invite-password"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => setShow((s) => !s)}
            aria-label={show ? 'Hide password' : 'Show password'}
            aria-pressed={show}
            className="absolute top-0.5 right-0.5 size-9 text-muted-foreground"
          >
            {show ? <EyeOff /> : <Eye />}
          </Button>
        </div>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-pw2`}>Type it again</Label>
        <Input
          id={`${id}-pw2`}
          type={show ? 'text' : 'password'}
          autoComplete="new-password"
          value={pw2}
          onChange={(e) => setPw2(e.target.value)}
          maxLength={PASSWORD_MAX}
          className="h-10 text-base md:text-base"
          data-testid="invite-password2"
        />
      </div>
      {err && (
        <p role="alert" className="text-sm text-destructive" data-testid="invite-error">
          {err}
        </p>
      )}
      <Button type="submit" disabled={busy} className="h-10" data-testid="invite-submit">
        {busy && <LoaderCircle className="animate-spin" aria-hidden />} Set password
      </Button>
    </form>
  );
}
