import { Image } from 'expo-image';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, FadeIn, useReducedMotion } from 'react-native-reanimated';
import markPng from '../../assets/images/logo-mark.png';
import { AppText } from './app-text';
import { DotLoader } from './dot-loader';
import { colors, motion, spacing } from '@/theme';

/**
 * The native splash (app.json expo-splash-screen) draws splash-icon.png 112dp wide, centred on
 * the full window, on #F4F8FD. The mark here is the same artwork at the same size, centred on the
 * same full-screen root (edge-to-edge, so no inset offsets), on the same ground.
 */
const MARK_W = 112;
const MARK_H = 100;
/** If the mark never reports it is on screen, hand over anyway after this long. */
const READY_FAILSAFE_MS = 1500;

/**
 * In-app splash (mockup screen 1). Hand-off from the native splash:
 * 1. The mark renders on the very first frame (centred by flex, no layout measuring).
 * 2. When expo-image reports the mark is displayed, wait two frames so it is really painted,
 *    then `onReady` hides the native splash. Only then do the wordmark and loader rise in.
 * 3. `done` fades this layer out (CSS transition) and then unmounts it.
 */
export function BrandSplash({
  done,
  onReady,
  onHidden,
}: {
  done: boolean;
  onReady: () => void;
  onHidden: () => void;
}) {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(false);
  const readyFired = useRef(false);

  const fireReady = () => {
    if (readyFired.current) return;
    readyFired.current = true;
    // Two frames: the first commits the mark, the second is after it reached the screen.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        onReady();
        setShown(true);
      }),
    );
  };

  useEffect(() => {
    const t = setTimeout(fireReady, READY_FAILSAFE_MS);
    return () => clearTimeout(t);
    // fireReady is stable in effect (guarded by a ref); run once.
  }, []);

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
      accessible
      accessibilityLabel="AriForce, Field Force CRM, Arighna Pharma. Loading"
    >
      <View style={[StyleSheet.absoluteFill, styles.center]}>
        <Image
          source={markPng}
          style={styles.mark}
          contentFit="contain"
          transition={null}
          priority="high"
          cachePolicy="memory"
          onDisplay={fireReady}
        />
      </View>
      {shown ? (
        <>
          <Animated.View entering={words} style={styles.words}>
            <AppText variant="display">AriForce</AppText>
            <AppText variant="tagline" style={styles.tagline}>
              Field Force CRM
            </AppText>
            <AppText variant="company" style={styles.company}>
              Arighna Pharma
            </AppText>
          </Animated.View>
          <Animated.View entering={FadeIn.duration(motion.base).delay(120)} style={styles.loader}>
            <DotLoader />
          </Animated.View>
        </>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: colors.ground, zIndex: 10 },
  center: { alignItems: 'center', justifyContent: 'center' },
  mark: { width: MARK_W, height: MARK_H },
  // Under the mark: its bottom edge is at 50% + MARK_H / 2.
  words: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: '50%',
    marginTop: MARK_H / 2 + spacing.lg,
    alignItems: 'center',
  },
  tagline: { marginTop: spacing.md },
  company: { marginTop: spacing.sm },
  loader: { position: 'absolute', left: 0, right: 0, top: '74%', alignItems: 'center' },
});
