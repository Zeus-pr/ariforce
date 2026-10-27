import { ProfileView } from '@/components/team/profile-view';

export const metadata = { title: 'Team member' };

export default async function MemberPage({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4 sm:p-6">
      <ProfileView userId={userId} />
    </div>
  );
}
