import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';
import Animated, { FadeInDown, FadeIn, useReducedMotion } from 'react-native-reanimated';
import markPng from '../../assets/images/logo-mark.png';
import { AppText } from './app-text';
import { DotLoader } from './dot-loader';
import { colors, motion, spacing } from '@/theme';

const MARK_W = 112;
const MARK_H = 100;

/**
 * In-app splash (mockup screen 1), the one "rare moment" with an entrance. The mark sits exactly
 * where the native splash draws it (centred, 112dp), so the hand-off is seamless; the wordmark
 * and loader rise in under it. `done` fades the layer out (CSS transition) and then unmounts it.
 */
export function BrandSplash({ done, onHidden }: { done: boolean; onHidden: () => void }) {
  const reduced = useReducedMotion();
  const [h, setH] = useState(0);

  useEffect(() => {
    if (!done) return;
    const t = setTimeout(onHidden, motion.base + 20);
    return () => clearTimeout(t);
  }, [done, onHidden]);

  const words = reduced
    ? FadeIn.duration(motion.base)
    : FadeInDown.duration(420)
        .easing(motion.easeOut)
        .withInitialValues({ transform: [{ translateY: 10 }] });

  return (
    <Animated.View
      pointerEvents={done ? 'none' : 'auto'}
      style={[
        StyleSheet.absoluteFill,
        styles.root,
        {
          opacity: done ? 0 : 1,
          transitionProperty: 'opacity',
          transitionDuration: motion.base,
          transitionTimingFunction: motion.cssEaseOut,
        },
      ]}
      onLayout={(e) => setH(e.nativeEvent.layout.height)}
      accessible
      accessibilityLabel="AriForce, Field Force CRM, Arighna Pharma. Loading"
    >
      {h > 0 && (
        <>
          <Image
            source={markPng}
            style={[styles.mark, { top: h / 2 - MARK_H / 2 }]}
            contentFit="contain"
          />
          <Animated.View
            entering={words}
            style={[styles.words, { top: h / 2 + MARK_H / 2 + spacing.lg }]}
          >
            <AppText variant="display">AriForce</AppText>
            <AppText variant="tagline" style={styles.tagline}>
              Field Force CRM
            </AppText>
            <AppText variant="company" style={styles.company}>
              Arighna Pharma
            </AppText>
          </Animated.View>
          <Animated.View
            entering={FadeIn.duration(motion.base).delay(120)}
            style={[styles.loader, { top: h * 0.74 }]}
          >
            <DotLoader />
          </Animated.View>
        </>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: colors.ground, zIndex: 10 },
  mark: { position: 'absolute', alignSelf: 'center', width: MARK_W, height: MARK_H },
  words: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  tagline: { marginTop: spacing.md },
  company: { marginTop: spacing.sm },
  loader: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
});
