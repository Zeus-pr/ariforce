'use client';

/* Same card and field styling as sign-in-form (shadcn login-03 layout, AriForce tokens). */
import { useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import { CircleCheck, Eye, EyeOff, LoaderCircle } from 'lucide-react';
import { Button } from '@ariforce/ui/components/button';
import { Input } from '@ariforce/ui/components/input';
import { Label } from '@ariforce/ui/components/label';
import { REAL } from '@/lib/api';
import { PASSWORD_MAX, PASSWORD_MIN, PASSWORD_PATTERN, ROLE_RANK } from '@ariforce/contracts';
import { ROLE_LABEL } from '@/lib/roles';
import { PasswordRules } from '@/components/auth/password-rules';
import {
  SIGNUP_ROLES,
  SignupError,
  signupAdapter,
  signupOptions,
  takesManager,
  validate,
  type SignupInput,
  type SignupOptions,
} from '@/lib/signup/adapter';

type Field = 'name' | 'email' | 'phone' | 'password' | 'requestedRole';
const SELECT =
  'h-10 w-full rounded-md border border-input bg-transparent px-3 text-base shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-[invalid=true]:border-destructive';
const ROLE_OPTIONS = SIGNUP_ROLES;

export function SignUpForm() {
  const id = useId();
  const [v, setV] = useState({
    name: '',
    email: '',
    phone: '',
    password: '',
    requestedRole: '',
    territoryId: '',
    managerId: '',
  });
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ field?: Field; message: string } | null>(null);
  const [sent, setSent] = useState<{ email: string; message: string } | null>(null);
  const [opts, setOpts] = useState<SignupOptions | null>(null);
  const refs = useRef<Partial<Record<Field, HTMLInputElement | HTMLSelectElement | null>>>({});

  useEffect(() => {
    // Optional pickers from the public sign-up options; on any failure they stay hidden.
    const ctrl = new AbortController();
    void signupOptions(ctrl.signal).then((o) => !ctrl.signal.aborted && setOpts(o));
    return () => ctrl.abort();
  }, []);

  const hqs = opts?.territories ?? [];
  const role = (v.requestedRole || null) as SignupInput['requestedRole'] | null;
  // Managers only for hierarchy roles below director, and only people ranked above the requested role.
  const managers =
    role && takesManager(role)
      ? (opts?.managers ?? []).filter((m) => ROLE_RANK[m.role] > ROLE_RANK[role])
      : [];

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
    // Nulls, not empty strings (SignupRequestCreate).
    const input: SignupInput = {
      name: v.name.trim(),
      email: v.email.trim(),
      phone: v.phone.trim() || null,
      password: v.password,
      requestedRole: v.requestedRole as SignupInput['requestedRole'],
      territoryId: v.territoryId || null,
      managerId: (role && takesManager(role) && v.managerId) || null,
    };
    const bad = validate(input);
    if (bad) {
      setError({ field: bad.field, message: bad.message });
      if (bad.field) refs.current[bad.field]?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const message = await signupAdapter.submit(input);
      setV((s) => ({ ...s, password: '' })); // drop plaintext from memory as soon as it is sent
      setSent({ email: input.email.toLowerCase(), message });
    } catch (x) {
      const se = x instanceof SignupError ? x : new SignupError('Something went wrong. Try again.');
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
          {sent.message} We sent it for{' '}
          <span className="font-medium text-foreground">{sent.email}</span>.
        </p>
        <Button asChild className="mt-5 h-10 w-full">
          <Link href="/sign-in">Back to sign in</Link>
        </Button>
      </div>
    );

  return (
    <div className="af-page rounded-lg border bg-card p-5 shadow-xs sm:p-6">
      {!REAL && (
        <p
          role="note"
          className="mb-5 border-l-2 border-warning pl-3 text-[13px] leading-snug text-warning-text"
        >
          Mock mode. The request stays in this browser; sign in with the System Admin demo account
          to review it.
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
          <Label htmlFor={`${id}-phone`}>
            Mobile number <span className="font-normal text-muted-foreground">(optional)</span>
          </Label>
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
          <PasswordRules password={v.password} id={`${id}-password-rules`} />
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
              aria-describedby={`${id}-password-rules${err('password') ? ` ${id}-password-err` : ''}`}
              minLength={PASSWORD_MIN}
              maxLength={PASSWORD_MAX}
              pattern={PASSWORD_PATTERN}
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
          <Err f="password" />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={`${id}-requestedRole`}>Your role</Label>
          <select
            ref={(el) => void (refs.current.requestedRole = el)}
            id={`${id}-requestedRole`}
            name="requestedRole"
            value={v.requestedRole}
            onChange={set('requestedRole')}
            {...aria('requestedRole')}
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
          <Err f="requestedRole" />
        </div>
        {hqs.length > 0 && (
          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-hq`}>
              HQ <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <select
              id={`${id}-hq`}
              name="territoryId"
              value={v.territoryId}
              onChange={set('territoryId')}
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
        {managers.length > 0 && (
          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-mgr`}>
              Reports to <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <select
              id={`${id}-mgr`}
              name="managerId"
              value={v.managerId}
              onChange={set('managerId')}
              className={SELECT}
              data-testid="signup-manager"
            >
              <option value="">Not sure</option>
              {managers.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}, {ROLE_LABEL[m.role]}
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
