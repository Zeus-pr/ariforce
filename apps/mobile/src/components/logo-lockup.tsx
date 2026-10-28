import { Image, StyleSheet, Text, View } from 'react-native';
import { colors, fonts } from '@/theme';
import markPng from '../../assets/images/logo-mark.png';

/** Small mark + wordmark, as in the app header of the mockups. */
export function LogoLockup({ size = 28 }: { size?: number }) {
  return (
    <View style={styles.row} accessibilityRole="image" accessibilityLabel="AriForce">
      <Image
        source={markPng}
        style={{ width: size, height: (size * 100) / 112 }}
        resizeMode="contain"
      />
      <Text style={[styles.word, { fontSize: size * 0.68 }]}>AriForce</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  word: { fontFamily: fonts.bold, color: colors.brandNavy, letterSpacing: -0.3 },
});
