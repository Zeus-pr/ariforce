'use client';

/* Same card and field styling as sign-in-form (shadcn login-03 layout, AriForce tokens). */
import { useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import { CircleCheck, Eye, EyeOff, LoaderCircle } from 'lucide-react';
import { Button } from '@ariforce/ui/components/button';
import { Input } from '@ariforce/ui/components/input';
import { Label } from '@ariforce/ui/components/label';
import { REAL } from '@/lib/api';
import { ROLES, ROLE_LABEL, isSystemAdmin, type Role } from '@/lib/roles';
import {
  SignUpError,
  signupAdapter,
  strength,
  validate,
  type SignUpInput,
} from '@/lib/signup/adapter';
import type { Hq } from '@/lib/team-adapter/types';

type Field = keyof SignUpInput;
const SELECT =
  'h-10 w-full rounded-md border border-input bg-transparent px-3 text-base shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-[invalid=true]:border-destructive';
const ROLE_OPTIONS = ROLES.filter((r) => !isSystemAdmin(r));

export function SignUpForm() {
  const id = useId();
  const [v, setV] = useState({ name: '', email: '', phone: '', password: '', role: '', hqId: '' });
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ field?: Field; message: string } | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [hqs, setHqs] = useState<Hq[]>([]);
  const refs = useRef<Partial<Record<Field, HTMLInputElement | HTMLSelectElement | null>>>({});

  useEffect(() => {
    let live = true;
    void signupAdapter.publicHqs().then((h) => live && setHqs(h));
    return () => {
      live = false;
    };
  }, []);

  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setV((s) => ({ ...s, [k]: e.target.value }));
  const err = (f: Field) => (error?.field === f ? error.message : null);
  const aria = (f: Field) => ({
    'aria-invalid': !!err(f),
    'aria-describedby': err(f) ? `${id}-${f}-err` : undefined,
  });
  const Err = ({ f }: { f: Field }) =>
    err(f) ? (
      <p id={`${id}-${f}-err`} className="af-fade text-[13px] text-destructive">
        {err(f)}
      </p>
    ) : null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const input: SignUpInput = { ...v, role: v.role as Role, hqId: v.hqId || null };
    const bad = validate(input);
    if (bad) {
      setError({ field: bad.field, message: bad.message });
      if (bad.field) refs.current[bad.field]?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await signupAdapter.submit(input);
      setV((s) => ({ ...s, password: '' })); // drop plaintext from memory as soon as it is sent
      setSent(input.email.trim().toLowerCase());
    } catch (x) {
      const se = x instanceof SignUpError ? x : new SignUpError('Something went wrong. Try again.');
      setError({ field: se.field, message: se.message });
      if (se.field) refs.current[se.field]?.focus();
    } finally {
      setBusy(false);
    }
  };

  if (sent)
    return (
      <div
        className="af-page rounded-lg border bg-card p-6 text-center shadow-xs"
        data-testid="signup-sent"
        role="status"
      >
        <CircleCheck className="mx-auto size-8 text-success" aria-hidden />
        <h2 className="mt-3 text-lg font-semibold">Request sent, awaiting approval</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          We sent your request for <span className="font-medium text-foreground">{sent}</span>. An
          admin or your manager will review it. You can sign in once it is approved.
        </p>
        <Button asChild className="mt-5 h-10 w-full">
          <Link href="/sign-in">Back to sign in</Link>
        </Button>
      </div>
    );

  const st = strength(v.password);
  return (
    <div className="af-page rounded-lg border bg-card p-5 shadow-xs sm:p-6">
      {!REAL && (
        <p
          role="note"
          className="mb-5 border-l-2 border-warning pl-3 text-[13px] leading-snug text-warning-text"
        >
          Mock mode. The request stays in this browser; sign in as admin@ariforce.test to review it.
        </p>
      )}
      {error && !error.field && (
        <p role="alert" data-testid="signup-error" className="mb-4 text-[13px] text-destructive">
          {error.message}
        </p>
      )}
      <form onSubmit={submit} noValidate className="grid gap-4" data-testid="signup-form">
        <div className="grid gap-1.5">
          <Label htmlFor={`${id}-name`}>Full name</Label>
          <Input
            ref={(el) => void (refs.current.name = el)}
            id={`${id}-name`}
            name="name"
            autoComplete="name"
            value={v.name}
            onChange={set('name')}
            {...aria('name')}
            className="h-10 text-base md:text-base"
          />
          <Err f="name" />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={`${id}-email`}>Work email</Label>
          <Input
            ref={(el) => void (refs.current.email = el)}
            id={`${id}-email`}
            name="email"
            type="email"
            inputMode="email"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            value={v.email}
            onChange={set('email')}
            {...aria('email')}
            className="h-10 text-base md:text-base"
          />
          <Err f="email" />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={`${id}-phone`}>Mobile number</Label>
          <Input
            ref={(el) => void (refs.current.phone = el)}
            id={`${id}-phone`}
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="+91 98xxx xxxxx"
            value={v.phone}
            onChange={set('phone')}
            {...aria('phone')}
            className="h-10 text-base md:text-base"
          />
          <Err f="phone" />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={`${id}-password`}>Password</Label>
          <div className="relative">
            <Input
              ref={(el) => void (refs.current.password = el)}
              id={`${id}-password`}
              name="password"
              type={show ? 'text' : 'password'}
              autoComplete="new-password"
              value={v.password}
              onChange={set('password')}
              aria-invalid={!!err('password')}
              aria-describedby={`${id}-password-hint${err('password') ? ` ${id}-password-err` : ''}`}
              className="h-10 pr-10 text-base md:text-base"
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
          <div id={`${id}-password-hint`} className="flex items-center gap-2" aria-live="polite">
            <div className="flex flex-1 gap-1" aria-hidden>
              {[1, 2, 3, 4].map((i) => (
                <span
                  key={i}
                  className={`h-1 flex-1 rounded-full ${i <= st.score ? (st.score >= 3 ? 'bg-success' : 'bg-warning') : 'bg-muted'}`}
                />
              ))}
            </div>
            <span className="text-xs text-muted-foreground" data-testid="pw-strength">
              {v.password ? st.label : 'At least 8 characters'}
            </span>
          </div>
          <Err f="password" />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={`${id}-role`}>Your role</Label>
          <select
            ref={(el) => void (refs.current.role = el)}
            id={`${id}-role`}
            name="role"
            value={v.role}
            onChange={set('role')}
            {...aria('role')}
            className={SELECT}
          >
            <option value="" disabled>
              Pick your role
            </option>
            {ROLE_OPTIONS.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
          <Err f="role" />
        </div>
        {hqs.length > 0 && (
          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-hq`}>
              HQ <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <select
              id={`${id}-hq`}
              name="hqId"
              value={v.hqId}
              onChange={set('hqId')}
              className={SELECT}
            >
              <option value="">Not sure</option>
              {hqs.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <Button type="submit" className="mt-1 h-10 w-full text-[15px]" disabled={busy}>
          {busy && <LoaderCircle className="animate-spin motion-reduce:animate-none" />}
          Send request
        </Button>
      </form>
      <p className="mt-4 text-center text-sm text-muted-foreground">
        Already approved?{' '}
        <Link
          href="/sign-in"
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          Sign in
        </Link>
      </p>
    </div>
  );
}
