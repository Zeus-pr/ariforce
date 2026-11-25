import { Stack, useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { AppText } from '@/components/app-text';
import { Button } from '@/components/button';
import { layout, spacing } from '@/theme';

/** A missing route stays on this screen. The default Expo page crashes after it paints. */
export default function NotFound() {
  const router = useRouter();
  return (
    <View style={styles.wrap}>
      <Stack.Screen options={{ title: 'Not found' }} />
      <AppText variant="section">This screen isn't in the app.</AppText>
      <Button label="Back to home" onPress={() => router.replace('/')} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    justifyContent: 'center',
    gap: spacing.lg,
    paddingHorizontal: layout.gutter,
  },
});
