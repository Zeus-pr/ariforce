import { SignupRequestsView } from '@/components/signups/signup-requests-view';

export const metadata = { title: 'Sign-up requests' };

export default function Page() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Sign-up requests</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          People waiting for an account. Approve to set their role, HQ and manager.
        </p>
      </div>
      <SignupRequestsView />
    </div>
  );
}
