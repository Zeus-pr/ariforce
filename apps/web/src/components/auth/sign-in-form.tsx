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
import { MOCK_PASSWORD, MOCK_USERS, signIn, type SignInError } from '@/lib/mock-auth';
import { canSee, homeFor } from '@/lib/nav';
import { ROLE_LABEL } from '@/lib/roles';

export function SignInForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState<SignInError | null>(null);
  const [pending, setPending] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const id = useId();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const result = signIn(email, password);
    if ('field' in result) {
      setError(result);
      (result.field === 'email' ? emailRef : passwordRef).current?.focus();
      return;
    }
    setError(null);
    setPending(true);
    const next = params.get('next');
    const safe = next && next.startsWith('/') && !next.startsWith('//') && canSee(result.role, next.split('?')[0] ?? next) ? next : null;
    router.replace(safe ?? homeFor(result.role));
  };

  const pick = (addr: string) => {
    setEmail(addr);
    setPassword(MOCK_PASSWORD);
    setError(null);
    passwordRef.current?.focus();
  };

  const err = (f: SignInError['field']) => (error?.field === f ? error.message : null);

  return (
    <>
      <div className="af-page rounded-lg border bg-card p-5 shadow-xs sm:p-6">
        <p
          role="note"
          data-testid="mock-note"
          className="af-enter af-enter-form mb-5 border-l-2 border-warning pl-3 text-[13px] leading-snug text-warning-text"
          style={{ '--i': 0 } as React.CSSProperties}
        >
          Mock sign-in. Demo accounts only, nothing leaves this browser. Password for every account:{' '}
          <span className="font-medium">{MOCK_PASSWORD}</span>
        </p>

        <form onSubmit={submit} noValidate className="grid gap-4">
          <div className="af-enter af-enter-form grid gap-1.5" style={{ '--i': 1 } as React.CSSProperties}>
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

          <div className="af-enter af-enter-form grid gap-1.5" style={{ '--i': 2 } as React.CSSProperties}>
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
          </div>

          <div className="af-enter af-enter-form" style={{ '--i': 3 } as React.CSSProperties}>
            <Button type="submit" className="h-10 w-full text-[15px]" disabled={pending}>
              {pending && <LoaderCircle className="animate-spin motion-reduce:animate-none" />}
              Sign in
            </Button>
          </div>
        </form>

        <details className="af-enter af-enter-form group mt-5 border-t pt-4" style={{ '--i': 4 } as React.CSSProperties}>
          <summary className="cursor-pointer list-none text-sm font-medium text-primary outline-none focus-visible:underline [&::-webkit-details-marker]:hidden">
            Demo accounts (one per role)
          </summary>
          <ul className="mt-3 grid gap-0.5" data-testid="mock-users">
            {MOCK_USERS.map((u) => (
              <li key={u.id}>
                <button
                  type="button"
                  onClick={() => pick(u.email)}
                  className="flex w-full items-baseline justify-between gap-3 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors duration-(--duration-fast) hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                >
                  <span className="truncate font-medium">{ROLE_LABEL[u.role]}</span>
                  <span className="shrink-0 text-muted-foreground tabular-nums">{u.email}</span>
                </button>
              </li>
            ))}
          </ul>
        </details>
      </div>
    </>
  );
}
