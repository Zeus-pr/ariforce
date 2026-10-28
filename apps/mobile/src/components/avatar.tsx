import { StyleSheet, View } from 'react-native';
import { AppText } from './app-text';
import { initial } from '@/lib/format';
import { colors, radius, sizes } from '@/theme';

/** Navy circle with the user's initial. Decorative: the parent labels it. */
export function Avatar({ name, large }: { name: string; large?: boolean }) {
  return (
    <View
      style={[styles.circle, large ? styles.large : styles.regular]}
      importantForAccessibility="no-hide-descendants"
    >
      <AppText variant={large ? 'avatarLg' : 'avatar'}>{initial(name)}</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  circle: {
    backgroundColor: colors.navy,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  regular: { width: sizes.avatar, height: sizes.avatar },
  large: { width: sizes.avatarLg, height: sizes.avatarLg },
});
