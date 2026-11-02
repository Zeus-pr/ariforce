'use client';

/*
 * Layout adapted from shadcn/ui "login-03" block (MIT, https://ui.shadcn.com/blocks/login):
 * centred card, logo above, stacked fields. Restyled with AriForce tokens; social buttons removed.
 */
import { useId, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Eye, EyeOff, LoaderCircle } from 'lucide-react';
import { Button } from '@ariforce/ui/components/button';
import { Input } from '@ariforce/ui/components/input';
import { Label } from '@ariforce/ui/components/label';
import Link from 'next/link';
import { SUSPENDED_MESSAGE } from '@/lib/auth-errors';
import {
  PENDING_MESSAGE,
  REJECTED_MESSAGE,
  signIn,
  type SignInError,
} from '@/lib/auth';
import { canSee, homeFor } from '@/lib/nav';

export function SignInForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState<SignInError | null>(() => {
    const a = params.get('account');
    return a === 'pending'
      ? { field: 'password', message: PENDING_MESSAGE, account: 'pending' }
      : a === 'rejected'
        ? { field: 'password', message: REJECTED_MESSAGE, account: 'rejected' }
        : a === 'suspended'
          ? { field: 'password', message: SUSPENDED_MESSAGE, account: 'suspended' }
          : null;
  });
  const [pending, setPending] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const id = useId();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    const result = await signIn(email, password);
    if ('field' in result) setPending(false);
    if ('field' in result) {
      setError(result);
      (result.field === 'email' ? emailRef : passwordRef).current?.focus();
      return;
    }
    setError(null);
    setPending(true);
    const next = params.get('next');
    const safe =
      next &&
      next.startsWith('/') &&
      !next.startsWith('//') &&
      canSee(result.role, next.split('?')[0] ?? next)
        ? next
        : null;
    router.replace(safe ?? homeFor(result.role));
  };

  const err = (f: SignInError['field']) =>
    error?.field === f && !error.account ? error.message : null;

  return (
    <>
      <div className="af-page rounded-lg border bg-card p-5 shadow-xs sm:p-6">
        {error?.account && (
          <div
            role="status"
            data-testid="signin-account-status"
            className="af-fade mb-4 rounded-md border border-warning/40 bg-warning-soft px-3 py-2.5 text-[13px] leading-snug text-warning-text"
          >
            <p className="font-medium">
              {error.account === 'pending'
                ? 'Awaiting approval'
                : error.account === 'suspended'
                  ? 'Account suspended'
                  : 'Request not approved'}
            </p>
            <p className="mt-0.5">{error.message}</p>
          </div>
        )}
        <form onSubmit={submit} noValidate className="grid gap-4">
          <div
            className="af-enter af-enter-form grid gap-1.5"
            style={{ '--i': 1 } as React.CSSProperties}
          >
            <Label htmlFor={`${id}-email`}>Work email</Label>
            <Input
              ref={emailRef}
              id={`${id}-email`}
              name="email"
              type="email"
              inputMode="email"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={!!err('email')}
              aria-describedby={err('email') ? `${id}-email-err` : undefined}
              className="h-10 text-base md:text-base"
            />
            {err('email') && (
              <p id={`${id}-email-err`} className="af-fade text-[13px] text-destructive">
                {err('email')}
              </p>
            )}
          </div>

          <div
            className="af-enter af-enter-form grid gap-1.5"
            style={{ '--i': 2 } as React.CSSProperties}
          >
            <Label htmlFor={`${id}-password`}>Password</Label>
            <div className="relative">
              <Input
                ref={passwordRef}
                id={`${id}-password`}
                name="password"
                type={show ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-invalid={!!err('password')}
                aria-describedby={err('password') ? `${id}-password-err` : undefined}
                className="h-10 pr-10 text-base md:text-base"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setShow((v) => !v)}
                aria-label={show ? 'Hide password' : 'Show password'}
                aria-pressed={show}
                className="absolute top-0.5 right-0.5 size-9 text-muted-foreground"
              >
                {show ? <EyeOff /> : <Eye />}
              </Button>
            </div>
            {err('password') && (
              <p id={`${id}-password-err`} className="af-fade text-[13px] text-destructive">
                {err('password')}
              </p>
            )}
            <div className="flex justify-end">
              <Link
                href={`/forgot-password${email ? `?email=${encodeURIComponent(email)}` : ''}`}
                data-testid="forgot-link"
                className="rounded-sm text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                Forgot password?
              </Link>
            </div>
          </div>

          <div className="af-enter af-enter-form" style={{ '--i': 3 } as React.CSSProperties}>
            <Button type="submit" className="h-10 w-full text-[15px]" disabled={pending}>
              {pending && <LoaderCircle className="animate-spin motion-reduce:animate-none" />}
              Sign in
            </Button>
          </div>
        </form>

        <p
          className="af-enter af-enter-form mt-4 text-center text-sm text-muted-foreground"
          style={{ '--i': 4 } as React.CSSProperties}
        >
          New to AriForce?{' '}
          <Link
            href="/sign-up"
            data-testid="sign-up-link"
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            Request an account
          </Link>
        </p>
      </div>
    </>
  );
}
