import type { Metadata } from 'next';
import Image from 'next/image';
import { Suspense } from 'react';
import { ForgotPasswordForm } from '@/components/auth/forgot-password-form';

export const metadata: Metadata = { title: 'Reset your password', referrer: 'no-referrer' };

export default function ForgotPasswordPage() {
  return (
    <main className="flex min-h-dvh items-start justify-center bg-muted/40 px-4 pt-[8vh] pb-10 sm:pt-[10vh]">
      <div className="w-full max-w-sm">
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
              Reset your password
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              We email a 6-digit code to your work address.
            </p>
          </div>
        </div>
        <Suspense fallback={<div className="h-64" aria-busy="true" />}>
          <ForgotPasswordForm />
        </Suspense>
      </div>
    </main>
  );
}
