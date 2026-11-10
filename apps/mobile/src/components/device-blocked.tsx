import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import markPng from '../../assets/images/logo-mark.png';
import type { DeviceBlockKind, DeviceBlockReason } from '@/lib/device-integrity';
import { colors, fonts, layout, motion, sizes, spacing } from '@/theme';
import { AppText } from './app-text';
import { Button } from './button';
import { Icon, type IconName } from './icon';

type Props = {
  reason: DeviceBlockReason;
  onRecheck: () => void;
  checking?: boolean;
};

const KIND_ICON: Record<DeviceBlockKind, IconName> = {
  emulator: 'cellphone-off',
  rooted: 'shield-off-outline',
  jailbroken: 'cellphone-key',
  hooks: 'bug-outline',
  developer: 'code-braces',
  adb: 'usb',
  mock: 'map-marker-off-outline',
};

/**
 * Full-screen stop when the device fails integrity — branded in-app screen, never a native alert.
 */
export function DeviceBlocked({ reason, onRecheck, checking }: Props) {
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const enter = reduced
    ? FadeIn.duration(motion.base)
    : FadeInDown.duration(480)
        .easing(motion.easeOut)
        .withInitialValues({ transform: [{ translateY: 16 }] });

  return (
    <View
      style={[
        styles.root,
        { paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + spacing.xl },
      ]}
      accessibilityRole="alert"
    >
      <View pointerEvents="none" style={styles.atmosphere}>
        <View style={styles.blobTeal} />
        <View style={styles.blobNavy} />
        <View style={styles.ringOuter} />
        <View style={styles.ringInner} />
      </View>

      <Animated.View entering={enter} style={styles.body}>
        <Image source={markPng} style={styles.mark} contentFit="contain" accessible={false} />

        <View style={styles.hero}>
          <View style={styles.heroRing}>
            <View style={styles.heroWash}>
              <Icon name={KIND_ICON[reason.kind]} size={40} color={colors.canopyDeep} />
            </View>
          </View>
        </View>

        <View style={styles.copy}>
          <AppText variant="tagline" style={styles.eyebrow}>
            Device check
          </AppText>
          <AppText variant="title" accessibilityRole="header" style={styles.headline}>
            {reason.headline}
          </AppText>
          <AppText variant="bodyMuted" style={styles.detail}>
            {reason.detail}
          </AppText>
        </View>

        <View style={styles.actions}>
          <Button
            label={checking ? 'Checking…' : 'Check again'}
            onPress={onRecheck}
            loading={checking}
            variant="primary"
          />
          <AppText variant="caption" style={styles.footnote}>
            Fix the issue above, then come back — we’ll let you in the moment the phone looks clean.
          </AppText>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.ground,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: layout.gutter,
    zIndex: 100,
    overflow: 'hidden',
  },
  atmosphere: {
    ...StyleSheet.absoluteFill,
  },
  blobTeal: {
    position: 'absolute',
    top: -80,
    right: -60,
    width: 280,
    height: 280,
    borderRadius: 140,
    backgroundColor: colors.tealWash,
    opacity: 0.9,
  },
  blobNavy: {
    position: 'absolute',
    bottom: -100,
    left: -80,
    width: 320,
    height: 320,
    borderRadius: 160,
    backgroundColor: colors.brandNavyWash,
    opacity: 0.85,
  },
  ringOuter: {
    position: 'absolute',
    alignSelf: 'center',
    top: '22%',
    width: 220,
    height: 220,
    marginLeft: -110,
    left: '50%',
    borderRadius: 110,
    borderWidth: 1,
    borderColor: colors.tealSoft,
    opacity: 0.55,
  },
  ringInner: {
    position: 'absolute',
    alignSelf: 'center',
    top: '26%',
    width: 160,
    height: 160,
    marginLeft: -80,
    left: '50%',
    borderRadius: 80,
    borderWidth: 1,
    borderColor: colors.separator,
    opacity: 0.7,
  },
  body: {
    width: '100%',
    maxWidth: sizes.readable + 40,
    alignItems: 'center',
    gap: spacing.xxl,
  },
  mark: { width: 56, height: 50 },
  hero: { alignItems: 'center', justifyContent: 'center' },
  heroRing: {
    width: 112,
    height: 112,
    borderRadius: 56,
    borderCurve: 'continuous',
    borderWidth: 1.5,
    borderColor: colors.tealSoft,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.canopyDeep,
    shadowOpacity: 0.12,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 4,
  },
  heroWash: {
    width: 88,
    height: 88,
    borderRadius: 44,
    borderCurve: 'continuous',
    backgroundColor: colors.tealWash,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: { alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.sm },
  eyebrow: {
    textAlign: 'center',
    color: colors.canopyDeep,
    fontFamily: fonts.medium,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  headline: { textAlign: 'center' },
  detail: { textAlign: 'center', maxWidth: 300 },
  actions: { alignSelf: 'stretch', gap: spacing.md },
  footnote: { textAlign: 'center', color: colors.subtle, paddingHorizontal: spacing.md },
});
