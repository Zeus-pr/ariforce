import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText } from './app-text';
import { Icon } from './icon';
import { colors, iconSize, layout, radius, sizes, spacing, touch } from '@/theme';

/**
 * The one header every screen uses (tabs and pushed screens). Drawn in JS so the status-bar
 * inset is applied exactly once (here, from safe-area-context) and the layout is the same on
 * Android and iOS: a 56dp row under the status bar, on the screen's own ground colour.
 *
 * Back: 48dp target 4dp from the edge, so the arrow sits on the 16dp gutter; the title starts
 * 16dp after the arrow. Without back, the title starts on the gutter like the content below.
 */
export function AppHeader({
  title,
  titleNode,
  onBack,
  right,
  background,
}: {
  title: string;
  /** Replaces the text title visually (Home's logo); `title` stays the accessible name. */
  titleNode?: ReactNode;
  onBack?: () => void;
  right?: ReactNode;
  /** Band colour behind the header and the status bar (default: the ground). */
  background?: string;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        styles.bar,
        background ? { backgroundColor: background } : null,
        { paddingTop: insets.top, paddingLeft: insets.left, paddingRight: insets.right },
      ]}
    >
      <View
        style={[
          styles.row,
          onBack ? styles.withBack : styles.noBack,
          right ? styles.withRight : styles.noRight,
        ]}
      >
        {onBack ? (
          <Pressable
            onPress={onBack}
            accessibilityRole="button"
            accessibilityLabel="Back"
            style={({ pressed }) => [styles.back, pressed && styles.backPressed]}
          >
            <Icon name="arrow-left" size={iconSize.lg} color={colors.navy} />
          </Pressable>
        ) : null}
        <View style={[styles.title, onBack && styles.titleAfterBack]}>
          {titleNode ?? (
            <AppText variant="section" numberOfLines={1} accessibilityRole="header">
              {title}
            </AppText>
          )}
        </View>
        {right}
      </View>
    </View>
  );
}

// Right-side 48dp targets: pad so a centred avatar/icon lines up with the 16dp gutter.
const RIGHT_PAD = layout.gutter - (touch.min - sizes.avatar) / 2;

const styles = StyleSheet.create({
  bar: { backgroundColor: colors.ground },
  row: { height: sizes.header, flexDirection: 'row', alignItems: 'center' },
  withBack: { paddingLeft: spacing.xs },
  noBack: { paddingLeft: layout.gutter },
  withRight: { paddingRight: RIGHT_PAD },
  noRight: { paddingRight: layout.gutter },
  back: {
    width: touch.min,
    height: touch.min,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backPressed: { backgroundColor: colors.separator },
  title: { flex: 1, minWidth: 0, justifyContent: 'center' },
  titleAfterBack: { marginLeft: spacing.xs },
});
