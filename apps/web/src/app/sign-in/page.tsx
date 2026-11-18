import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AuthFibers } from '@/components/auth/auth-fibers';
import { SignInDesk } from '@/components/auth/sign-in-desk';

export const metadata: Metadata = { title: 'Sign in' };

export default function SignInPage() {
  return (
    <main className="flex min-h-dvh items-start justify-center bg-white px-4 pt-[10vh] pb-10 sm:pt-[14vh]">
      <AuthFibers />
      <Suspense
        fallback={
          <div className="af-page min-h-[420px] w-full max-w-sm rounded-lg border bg-card" />
        }
      >
        <SignInDesk />
      </Suspense>
    </main>
  );
}
