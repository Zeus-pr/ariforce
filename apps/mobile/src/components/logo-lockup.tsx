import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';
import markPng from '../../assets/images/logo-mark.png';
import { AppText } from './app-text';
import { spacing } from '@/theme';

/** Small mark + wordmark, as in the app header of the mockups. */
export function LogoLockup() {
  return (
    <View style={styles.row} accessible accessibilityRole="image" accessibilityLabel="AriForce">
      <Image source={markPng} style={styles.mark} contentFit="contain" />
      <AppText variant="wordmarkSm">AriForce</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  mark: { width: 28, height: 25 },
});
