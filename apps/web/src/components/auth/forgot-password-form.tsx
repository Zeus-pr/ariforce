'use client';

import { useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Eye, EyeOff, LoaderCircle, MailCheck } from 'lucide-react';
import { Button } from '@ariforce/ui/components/button';
import { Input } from '@ariforce/ui/components/input';
import { Label } from '@ariforce/ui/components/label';
import { toast } from '@ariforce/ui/components/sonner';
import { strength } from '@/lib/signup/adapter';
import {
  CODE_LENGTH,
  RESEND_SECONDS,
  RESET_PASSWORD_MIN as MIN,
  RESET_PASSWORD_MAX as MAX,
  resetPassword,
  sendResetCode,
  type ResetFailure,
} from '@/lib/password-reset/adapter';

const GENERIC = 'If the account exists, we sent a code';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const busyText = (s: number | null) =>
  s ? `Too many attempts, try again in ${s} seconds.` : 'Too many attempts, try again in a minute.';

function failureText(f: ResetFailure): string {
  switch (f.kind) {
    case 'wrong':
      return 'That code is not right. Check the latest email and try again.';
    case 'expired':
      return 'That code has expired. Send a new code and use the latest one.';
    case 'attempts':
      return 'Too many wrong codes. Send a new code to try again.';
    case 'busy':
      return busyText(f.seconds);
    case 'invalid':
      return f.message || `Password must be at least ${MIN} characters.`;
    default:
      return 'Could not reach the server. Check your connection and try again.';
  }
}

export function ForgotPasswordForm() {
  const id = useId();
  const router = useRouter();
  const params = useSearchParams();
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState(() => params.get('email') ?? '');
  const [code, setCode] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{
    field: 'email' | 'code' | 'pw' | 'pw2' | 'form';
    text: string;
  } | null>(null);
  const [wait, setWait] = useState(0);
  const codeRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  const send = async (again = false) => {
    if (!EMAIL_RE.test(email.trim())) {
      setErr({ field: 'email', text: 'Enter your work email.' });
      emailRef.current?.focus();
      return;
    }
    setErr(null);
    setBusy(true);
    const r = await sendResetCode(email);
    setBusy(false);
    // Whatever the API says (unknown email included), the answer looks the same. Only 429 is shown.
    if (!('ok' in r) && r.kind === 'busy') {
      setErr({ field: again ? 'form' : 'email', text: busyText(r.seconds) });
      if (r.seconds) setWait(r.seconds);
      return;
    }
    setWait(RESEND_SECONDS);
    setCode('');
    setStep('code');
    if (again) toast.success(GENERIC);
    setTimeout(() => codeRef.current?.focus(), 0);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (code.length !== CODE_LENGTH)
      return setErr({ field: 'code', text: `Enter the ${CODE_LENGTH}-digit code from the email.` });
    if (pw.length < MIN) return setErr({ field: 'pw', text: `Use at least ${MIN} characters.` });
    if (pw !== pw2) return setErr({ field: 'pw2', text: 'The two passwords do not match.' });
    setErr(null);
    setBusy(true);
    const r = await resetPassword(email, code, pw);
    setBusy(false);
    if ('ok' in r) {
      setPw('');
      setPw2('');
      setCode('');
      toast.success('Password changed. Sign in with your new password.', {
        description: 'You were signed out on every other device.',
      });
      router.replace(`/sign-in?email=${encodeURIComponent(email.trim().toLowerCase())}`);
      return;
    }
    if (r.kind === 'busy' && r.seconds) setWait((w) => Math.max(w, r.seconds!));
    setErr({
      field: r.kind === 'wrong' || r.kind === 'expired' || r.kind === 'attempts' ? 'code' : 'form',
      text: failureText(r),
    });
    if (r.kind === 'wrong') {
      setCode('');
      codeRef.current?.focus();
    }
  };

  const fieldErr = (f: string) =>
    err?.field === f ? (
      <p
        id={`${id}-${f}-err`}
        role="alert"
        className="af-fade text-[13px] text-destructive"
        data-testid={`fp-${f}-error`}
      >
        {err.text}
      </p>
    ) : null;

  if (step === 'email')
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
        noValidate
        className="grid gap-4 rounded-xl border bg-background p-5 shadow-xs"
        data-testid="fp-email-step"
      >
        <div className="grid gap-1.5">
          <Label htmlFor={`${id}-email`}>Work email</Label>
          <Input
            ref={emailRef}
            id={`${id}-email`}
            type="email"
            inputMode="email"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={err?.field === 'email'}
            aria-describedby={err?.field === 'email' ? `${id}-email-err` : undefined}
            className="h-10 text-base md:text-base"
            data-testid="fp-email"
          />
          {fieldErr('email')}
        </div>
        <Button type="submit" disabled={busy || wait > 0} className="h-10" data-testid="fp-send">
          {busy && <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden />}
          {wait > 0 ? `Send code (${wait}s)` : 'Send code'}
        </Button>
        <p className="text-center text-sm text-muted-foreground">
          <Link
            href="/sign-in"
            className="font-medium text-primary underline-offset-4 hover:underline"
            data-testid="fp-back"
          >
            Back to sign in
          </Link>
        </p>
      </form>
    );

  const st = strength(pw);
  return (
    <form
      onSubmit={submit}
      noValidate
      className="grid gap-4 rounded-xl border bg-background p-5 shadow-xs"
      data-testid="fp-code-step"
    >
      <p
        className="flex items-start gap-2 rounded-lg bg-muted/60 p-3 text-sm"
        role="status"
        data-testid="fp-sent"
      >
        <MailCheck className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
        <span>
          {GENERIC} to <span className="font-medium break-all">{email.trim().toLowerCase()}</span>.
          It can take a minute.
        </span>
      </p>
      <input type="text" name="username" autoComplete="username" hidden readOnly value={email} />
      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-code`}>6-digit code</Label>
        <Input
          ref={codeRef}
          id={`${id}-code`}
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          maxLength={CODE_LENGTH + 6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, CODE_LENGTH))}
          aria-invalid={err?.field === 'code'}
          aria-describedby={err?.field === 'code' ? `${id}-code-err` : undefined}
          className="h-11 text-center font-mono text-lg tracking-[0.4em] md:text-lg"
          data-testid="fp-code"
        />
        {fieldErr('code')}
        <div className="flex items-center justify-between gap-2 text-sm">
          <span className="text-muted-foreground">Did not get it? Check spam first.</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy || wait > 0}
            onClick={() => void send(true)}
            data-testid="fp-resend"
          >
            {wait > 0 ? `Resend code in ${wait}s` : 'Resend code'}
          </Button>
        </div>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-pw`}>New password</Label>
        <div className="relative">
          <Input
            id={`${id}-pw`}
            type={show ? 'text' : 'password'}
            autoComplete="new-password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            aria-invalid={err?.field === 'pw'}
            aria-describedby={`${id}-hint`}
            className="h-10 pr-10 text-base md:text-base"
            maxLength={MAX}
            data-testid="fp-password"
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
        <div id={`${id}-hint`} className="flex items-center gap-2" aria-live="polite">
          <div className="flex flex-1 gap-1" aria-hidden>
            {[1, 2, 3, 4].map((i) => (
              <span
                key={i}
                className={`h-1 flex-1 rounded-full ${i <= st.score ? (st.score >= 3 ? 'bg-success' : 'bg-warning') : 'bg-muted'}`}
              />
            ))}
          </div>
          <span className="text-xs text-muted-foreground" data-testid="fp-strength">
            {pw ? st.label : `At least ${MIN} characters`}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          Longer is stronger. Mix upper and lower case, numbers and symbols.
        </p>
        {fieldErr('pw')}
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-pw2`}>Type it again</Label>
        <Input
          id={`${id}-pw2`}
          type={show ? 'text' : 'password'}
          autoComplete="new-password"
          value={pw2}
          onChange={(e) => setPw2(e.target.value)}
          aria-invalid={err?.field === 'pw2'}
          className="h-10 text-base md:text-base"
          maxLength={MAX}
          data-testid="fp-password2"
        />
        {fieldErr('pw2')}
      </div>
      {fieldErr('form')}
      <Button type="submit" disabled={busy} className="h-10" data-testid="fp-submit">
        {busy && <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden />}
        Set new password
      </Button>
      <p className="flex justify-between gap-2 text-sm">
        <button
          type="button"
          className="font-medium text-primary underline-offset-4 hover:underline"
          onClick={() => {
            setStep('email');
            setErr(null);
          }}
          data-testid="fp-change-email"
        >
          Use a different email
        </button>
        <Link
          href="/sign-in"
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          Back to sign in
        </Link>
      </p>
    </form>
  );
}
