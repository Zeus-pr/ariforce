import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Image, StyleSheet, Text } from 'react-native';
import markPng from '../../assets/images/logo-mark.png';
import { DotLoader } from './dot-loader';
import { colors, EASE_OUT, fonts } from '@/theme';

const MARK_W = 112;
const MARK_H = 100;
const ease = Easing.bezier(...EASE_OUT);

/**
 * In-app splash (mockup screen 1). The mark sits exactly where the native splash draws it
 * (centred, 112dp wide), so the hand-off is seamless; the wordmark and loader rise in under it.
 * `done` fades the whole layer out and then calls onHidden.
 */
export function BrandSplash({ done, onHidden }: { done: boolean; onHidden: () => void }) {
  const [h, setH] = useState(0);
  const enter = useRef(new Animated.Value(0)).current;
  const exit = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.timing(enter, {
      toValue: 1,
      duration: 420,
      easing: ease,
      useNativeDriver: true,
    }).start();
  }, [enter]);

  useEffect(() => {
    if (!done) return;
    Animated.timing(exit, { toValue: 0, duration: 240, easing: ease, useNativeDriver: true }).start(
      ({ finished }) => finished && onHidden(),
    );
  }, [done, exit, onHidden]);

  const rise = enter.interpolate({ inputRange: [0, 1], outputRange: [10, 0] });

  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, styles.root, { opacity: exit }]}
      onLayout={(e) => setH(e.nativeEvent.layout.height)}
      accessibilityLabel="AriForce, Field Force CRM, Arighna Pharma. Loading"
    >
      {h > 0 && (
        <>
          <Image
            source={markPng}
            style={[styles.mark, { top: h / 2 - MARK_H / 2 }]}
            resizeMode="contain"
          />
          <Animated.View
            style={[
              styles.words,
              { top: h / 2 + MARK_H / 2 + 18, opacity: enter, transform: [{ translateY: rise }] },
            ]}
          >
            <Text style={styles.wordmark}>AriForce</Text>
            <Text style={styles.tagline}>Field Force CRM</Text>
            <Text style={styles.company}>Arighna Pharma</Text>
          </Animated.View>
          <Animated.View style={[styles.loader, { top: h * 0.74, opacity: enter }]}>
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
  wordmark: {
    fontFamily: fonts.bold,
    fontSize: 40,
    lineHeight: 46,
    letterSpacing: -0.8,
    color: colors.brandNavy,
  },
  tagline: {
    marginTop: 10,
    fontFamily: fonts.medium,
    fontSize: 15,
    letterSpacing: 2.4,
    color: colors.muted,
  },
  company: {
    marginTop: 8,
    fontFamily: fonts.regular,
    fontSize: 12,
    letterSpacing: 1.2,
    color: colors.subtle,
  },
  loader: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
});
