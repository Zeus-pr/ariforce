import type { Metadata } from 'next';
import Image from 'next/image';
import { AuthFibers } from '@/components/auth/auth-fibers';
import { SignUpForm } from '@/components/auth/sign-up-form';

export const metadata: Metadata = { title: 'Request an account' };

export default function SignUpPage() {
  return (
    <main className="flex min-h-dvh items-start justify-center bg-white px-4 pt-[8vh] pb-10 sm:pt-[10vh]">
      <AuthFibers />
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
              Request an account
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              An admin or your manager approves it before you can sign in.
            </p>
          </div>
        </div>
        <SignUpForm />
      </div>
    </main>
  );
}
