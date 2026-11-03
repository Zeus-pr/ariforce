import { memo } from 'react';
import { Image, StyleSheet, useWindowDimensions, View } from 'react-native';
import markPng from '../../assets/images/logo-mark.png';

/** logo-mark.png is 336x299 (transparent PNG). */
const ASPECT = 299 / 336;

/**
 * Faint AriForce mark centred behind a tab screen's content. Purely decorative: it ignores
 * touches, is hidden from screen readers and sits absolutely, so it never affects layout or scroll.
 * Opaque cards drawn above it simply cover it.
 */
export const Watermark = memo(function Watermark({ opacity = 0.07 }: { opacity?: number }) {
  const { width, height } = useWindowDimensions();
  const size = Math.round(Math.min(width, height) * 0.75);
  return (
    <View
      pointerEvents="none"
      style={styles.fill}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Image
        source={markPng}
        resizeMode="contain"
        style={{ width: size, height: Math.round(size * ASPECT), opacity }}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  fill: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
