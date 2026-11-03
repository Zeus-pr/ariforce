import type { Metadata } from 'next';
import Image from 'next/image';
import { Suspense } from 'react';
import { SignInForm } from '@/components/auth/sign-in-form';

export const metadata: Metadata = { title: 'Sign in' };

export default function SignInPage() {
  return (
    <main className="flex min-h-dvh items-start justify-center bg-muted/40 px-4 pt-[10vh] pb-10 sm:pt-[14vh]">
      <div className="w-full max-w-sm">
        {/* Server-rendered so the splash finds its landing box at hydration. The splash logo glides onto
            this box; 9:8 like the header mark so the FLIP scale is exact. */}
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
              Sign in to AriForce
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">Arighna Pharmaceutical field force</p>
          </div>
        </div>
        {/* Fixed min-height keeps the logo still while the form streams in. */}
        <Suspense fallback={<div className="af-page min-h-[420px] rounded-lg border bg-card" />}>
          <SignInForm />
        </Suspense>
      </div>
    </main>
  );
}
