import { InvitePeople } from '@/components/admin/invite-people';

export const metadata = { title: 'Invite people' };

export default function Page() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Invite people</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Send a sign-in link to an existing employee, or add someone new with any role and HQ.
        </p>
      </div>
      <InvitePeople />
    </div>
  );
}
