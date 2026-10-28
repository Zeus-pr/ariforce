import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { Avatar } from './avatar';
import { Icon } from './icon';
import { PressableScale } from './pressable-scale';
import { featureHref } from '@/lib/features';
import { colors, iconSize, radius, sizes, spacing, touch } from '@/theme';

/** Home header, right side: notifications bell (stub) and the account avatar (opens More). */
export function HeaderActions({ name, unread }: { name: string; unread: number }) {
  const router = useRouter();
  return (
    <View style={styles.row}>
      <PressableScale
        onPress={() => router.push(featureHref('notifications'))}
        accessibilityLabel={unread > 0 ? `Notifications, ${unread} new` : 'Notifications'}
        style={styles.target}
        scaleTo={0.9}
      >
        <Icon name="bell-outline" size={iconSize.lg} color={colors.ink} />
        {unread > 0 ? <View style={styles.badge} /> : null}
      </PressableScale>
      <PressableScale
        onPress={() => router.navigate('/more')}
        accessibilityLabel={`Account, ${name}`}
        style={styles.target}
        scaleTo={0.9}
      >
        <Avatar name={name} />
      </PressableScale>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  target: {
    width: touch.min,
    height: touch.min,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: spacing.md,
    right: spacing.md,
    width: sizes.badge,
    height: sizes.badge,
    borderRadius: radius.full,
    backgroundColor: colors.danger,
    borderWidth: 1.5,
    borderColor: colors.ground,
  },
});
