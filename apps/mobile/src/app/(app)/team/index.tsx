import { Redirect } from 'expo-router';
import { TeamPlace } from '@/components/team-place';
import { useAuth } from '@/lib/auth-context';
import { isApprover } from '@/lib/roles';

export default function TeamScreen() {
  const { user } = useAuth();
  if (!isApprover(user?.roles ?? [])) return <Redirect href="/" />;
  return <TeamPlace />;
}
