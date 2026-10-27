'use client';

import { useEffect, useRef, useId, useState } from 'react';
import Link from 'next/link';
import { CircleCheck, Eye, EyeOff, LinkIcon, LoaderCircle } from 'lucide-react';
import { Button } from '@ariforce/ui/components/button';
import { Input } from '@ariforce/ui/components/input';
import { Label } from '@ariforce/ui/components/label';
import { api, apiReady, toApiError } from '@/lib/api';
import { SIGNUP_PASSWORD_MIN, strength } from '@/lib/signup/adapter';

type State = 'reading' | 'missing' | 'form' | 'invalid' | 'done';

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

  const st = strength(pw);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pw.length < SIGNUP_PASSWORD_MIN) return setErr(`Use at least ${SIGNUP_PASSWORD_MIN} characters.`);
    if (pw !== pw2) return setErr('The two passwords do not match.');
    setErr(null);
    setBusy(true);
    await apiReady();
    const r = await api.POST('/v1/invites/accept', { body: { token: token!, password: pw } }).catch(() => null);
    setBusy(false);
    if (r?.data) {
      setPw('');
      setPw2('');
      setToken(null);
      setEmail(r.data.email);
      return setState('done');
    }
    const code = r ? toApiError(r).code : 'NETWORK';
    if (r?.response.status === 404 || code === 'INVITE_INVALID') {
      setToken(null);
      setPw('');
      setPw2('');
      return setState('invalid');
    }
    if (r?.response.status === 422) return setErr('That password was not accepted. Try a longer one.');
    if (r?.response.status === 429) return setErr('Too many tries. Wait a minute and try again.');
    setErr('Could not reach the server. Check your connection and try again.');
  };

  if (state === 'reading') return <div className="h-64" aria-busy="true" />;
  if (state === 'missing' || state === 'invalid')
    return (
      <div className="grid gap-3 rounded-xl border bg-background p-5 text-sm shadow-xs" data-testid={`invite-${state}`}>
        <p className="flex items-center gap-2 font-medium"><LinkIcon className="size-4" aria-hidden />
          {state === 'missing' ? 'This link is incomplete' : 'This invite link no longer works'}
        </p>
        <p className="text-muted-foreground">
          {state === 'missing'
            ? 'Open the full link your manager sent you, or ask them to copy it again.'
            : 'It may have expired (links last 7 days), been used already, or been replaced by a newer invite. Ask your manager to send a new one.'}
        </p>
        <Button asChild variant="outline"><Link href="/sign-in">Go to sign in</Link></Button>
      </div>
    );
  if (state === 'done')
    return (
      <div className="grid gap-3 rounded-xl border bg-background p-5 text-sm shadow-xs" data-testid="invite-done">
        <p className="flex items-center gap-2 font-medium"><CircleCheck className="size-4 text-success" aria-hidden /> Password set</p>
        <p className="text-muted-foreground">Sign in with {email ?? 'your work email'} and the password you just chose.</p>
        <Button asChild><Link href={`/sign-in${email ? `?email=${encodeURIComponent(email)}` : ''}`} data-testid="invite-to-sign-in">Sign in</Link></Button>
      </div>
    );
  return (
    <form onSubmit={submit} noValidate className="grid gap-4 rounded-xl border bg-background p-5 shadow-xs" data-testid="invite-form">
      <input type="text" name="username" autoComplete="username" hidden readOnly value="" />
      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-pw`}>New password</Label>
        <div className="relative">
          <Input id={`${id}-pw`} type={show ? 'text' : 'password'} autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} aria-describedby={`${id}-hint`} className="h-10 pr-10 text-base md:text-base" data-testid="invite-password" />
          <Button type="button" variant="ghost" size="icon" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide password' : 'Show password'} aria-pressed={show} className="absolute top-0.5 right-0.5 size-9 text-muted-foreground">
            {show ? <EyeOff /> : <Eye />}
          </Button>
        </div>
        <div id={`${id}-hint`} className="flex items-center gap-2" aria-live="polite">
          <div className="flex flex-1 gap-1" aria-hidden>
            {[1, 2, 3, 4].map((i) => (
              <span key={i} className={`h-1 flex-1 rounded-full ${i <= st.score ? (st.score >= 3 ? 'bg-success' : 'bg-warning') : 'bg-muted'}`} />
            ))}
          </div>
          <span className="text-xs text-muted-foreground" data-testid="pw-strength">{pw ? st.label : `At least ${SIGNUP_PASSWORD_MIN} characters`}</span>
        </div>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-pw2`}>Type it again</Label>
        <Input id={`${id}-pw2`} type={show ? 'text' : 'password'} autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} className="h-10 text-base md:text-base" data-testid="invite-password2" />
      </div>
      {err && <p role="alert" className="text-sm text-destructive" data-testid="invite-error">{err}</p>}
      <Button type="submit" disabled={busy} className="h-10" data-testid="invite-submit">
        {busy && <LoaderCircle className="animate-spin" aria-hidden />} Set password
      </Button>
    </form>
  );
}
