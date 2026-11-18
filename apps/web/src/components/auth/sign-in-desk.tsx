'use client';

import { useState, type HTMLAttributes } from 'react';
import Image from 'next/image';
import { SignInForm } from '@/components/auth/sign-in-form';

type Desk = 'field' | 'hr';

/** Fieldforce and HR share the company sign-in and land in different places. */
export function SignInDesk() {
  const [desk, setDesk] = useState<Desk>('field');
  const hr = desk === 'hr';

  return (
    <div className="relative z-10 w-full max-w-sm">
      <div className="mb-6 flex flex-col items-center gap-3 text-center">
        <Image
          src="/brand/ariforce-mark.png"
          alt=""
          width={45}
          height={40}
          priority
          data-af-header-logo
          className="block h-10 w-[45px]"
        />
        <div className="af-page">
          <h1 className="text-xl font-semibold tracking-tight text-primary">
            {hr ? 'Sign in to HR' : 'Sign in to AriForce'}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {hr ? 'People, joining and the reporting line' : 'Arighna Pharmaceutical field force'}
          </p>
        </div>
      </div>
      <div
        {...({ focusgroup: 'tablist' } as HTMLAttributes<HTMLDivElement>)}
        aria-label="Sign-in desk"
        className="mb-3 grid grid-cols-2 gap-1 rounded-lg border bg-card p-1"
      >
        <button
          type="button"
          aria-selected={!hr}
          onClick={() => setDesk('field')}
          className="h-9 rounded-md text-sm text-muted-foreground aria-selected:bg-primary aria-selected:font-medium aria-selected:text-primary-foreground"
        >
          Fieldforce
        </button>
        <button
          type="button"
          aria-selected={hr}
          onClick={() => setDesk('hr')}
          className="h-9 rounded-md text-sm text-muted-foreground aria-selected:bg-primary aria-selected:font-medium aria-selected:text-primary-foreground"
        >
          HRMS
        </button>
      </div>
      <SignInForm desk={desk} />
    </div>
  );
}
