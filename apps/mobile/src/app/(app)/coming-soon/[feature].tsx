import { Redirect, Stack, useLocalSearchParams } from 'expo-router';
import { ComingSoon } from '@/components/coming-soon';
import { FEATURES, isFeatureKey } from '@/lib/features';

/** Stub screen for any feature not built yet (quick actions, flags, bell, More links). */
export default function ComingSoonScreen() {
  const { feature } = useLocalSearchParams<{ feature: string }>();
  if (typeof feature !== 'string' || !isFeatureKey(feature)) return <Redirect href="/" />;
  return (
    <>
      <Stack.Screen options={{ title: FEATURES[feature].title }} />
      <ComingSoon feature={feature} />
    </>
  );
}
