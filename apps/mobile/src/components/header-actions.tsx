import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { AppText } from './app-text';
import { Avatar } from './avatar';
import { Icon } from './icon';
import { PressableScale } from './pressable-scale';
import { featureHref } from '@/lib/features';
import { colors, iconSize, radius, spacing, touch } from '@/theme';

/** Home header, right side: notifications bell (live unread count) and the account avatar (opens More). */
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
        {unread > 0 ? (
          <View style={styles.badge}>
            <AppText variant="chip" style={styles.badgeText} numberOfLines={1}>
              {unread > 99 ? '99+' : unread}
            </AppText>
          </View>
        ) : null}
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
    top: spacing.xs,
    right: spacing.xs,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.full,
    backgroundColor: colors.danger,
    borderWidth: 1.5,
    borderColor: colors.homeSky, // ring matches the Home band behind the bell
  },
  badgeText: { color: colors.onNavy, fontSize: 11, lineHeight: 14 },
});
