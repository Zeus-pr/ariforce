import { Image } from 'expo-image';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal,
  PanResponder,
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText } from '@/components/app-text';
import { Icon } from '@/components/icon';
import { doctorProductLabel, type ProductOpt } from '@/lib/dcr/adapter';
import { getScreenOrientation, lockLandscape, lockPortrait } from '@/lib/orientation';
import { colors, radius, spacing, touch } from '@/theme';

/**
 * Full-screen product presentation for a doctor call: one product per page, in the order picked,
 * swiped horizontally (FlatList paging), page dots and a close button. A product without an image
 * gets a name-only slide.
 */
export function Presentation({
  visible,
  products,
  onClose,
}: {
  visible: boolean;
  products: ProductOpt[];
  onClose: () => void;
}) {
  const win = useWindowDimensions();
  // The modal's real size (window values can lag during a rotation).
  const [box, setBox] = useState({ w: win.width, h: win.height });
  const insets = useSafeAreaInsets();
  const [page, setPage] = useState(0);
  const [landscape, setLandscape] = useState(false);
  // Hidden when this binary has no expo-screen-orientation (built before it was added).
  const canRotate = getScreenOrientation() != null;

  useEffect(() => {
    if (visible) {
      setPage(0);
      // Opens in landscape so slides fill the screen.
      setLandscape(true);
      void lockLandscape();
      // iPad/iOS can ignore a lock requested before the modal is on screen; ask again shortly after.
      const t = setTimeout(() => void lockLandscape(), 350);
      return () => clearTimeout(t);
    }
  }, [visible]);

  // Back to portrait on close, back press (onRequestClose) and unmount.
  useEffect(() => {
    if (!visible) return;
    return () => {
      void lockPortrait();
    };
  }, [visible]);

  const close = useCallback(() => {
    void lockPortrait();
    setLandscape(false);
    onClose();
  }, [onClose]);

  const rotate = () => {
    const next = !landscape;
    setLandscape(next);
    void (next ? lockLandscape() : lockPortrait());
  };

  // If the OS refused the landscape lock (e.g. iPad / Expo Go), turn the content 90° ourselves.
  const turn = landscape && box.h > box.w;
  const width = turn ? box.h : box.w;
  const height = turn ? box.w : box.h;
  const topInset = turn ? spacing.md : insets.top;

  const current = products[Math.min(page, Math.max(0, products.length - 1))];
  const count = products.length;
  // Swipe left/right to change slide. When the content is turned 90°, its x axis is the screen's y.
  const swipe = useRef({ turn, count });
  swipe.current = { turn, count };
  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponderCapture: (_, g) => {
          const d = swipe.current.turn ? g.dy : g.dx;
          const o = swipe.current.turn ? g.dx : g.dy;
          return Math.abs(d) > 10 && Math.abs(d) > Math.abs(o);
        },
        onPanResponderRelease: (_, g) => {
          const d = swipe.current.turn ? g.dy : g.dx;
          if (Math.abs(d) < 40) return;
          setPage((p) => Math.max(0, Math.min(swipe.current.count - 1, p + (d < 0 ? 1 : -1))));
        },
      }),
    [],
  );

  return (
    <Modal
      visible={visible}
      animationType="fade"
      onRequestClose={close}
      onShow={() => {
        if (landscape) void lockLandscape();
      }}
      supportedOrientations={['portrait', 'landscape', 'landscape-left', 'landscape-right']}
      statusBarTranslucent
      navigationBarTranslucent
    >
      <View
        style={styles.root}
        onLayout={(e) => setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
      >
        <View
          style={{
            position: 'absolute',
            width,
            height,
            left: (box.w - width) / 2,
            top: (box.h - height) / 2,
            transform: turn ? [{ rotate: '90deg' }] : [],
          }}
        >
          {/* A plain view, not a scroll view: iOS 26 blurs scroll views' edges under the system bars. */}
          <View style={{ width, height }} collapsable={false} {...pan.panHandlers}>
            {current ? (
              <View
                style={[styles.slide, { width, height }]}
                accessible
                accessibilityLabel={`${doctorProductLabel(current)}, product ${page + 1} of ${products.length}`}
              >
                {current.imageUrl ? (
                  <Image
                    key={current.id}
                    pointerEvents="none"
                    source={{ uri: current.imageUrl }}
                    style={styles.image}
                    contentFit="contain"
                    contentPosition="center"
                    allowDownscaling={false}
                    priority="high"
                    transition={120}
                  />
                ) : (
                  <View style={styles.nameOnly}>
                    <AppText variant="display" style={styles.bigName}>
                      {doctorProductLabel(current)}
                    </AppText>
                  </View>
                )}
              </View>
            ) : null}
          </View>

          {count > 1 && page > 0 ? (
            <Pressable
              onPress={() => setPage((p) => Math.max(0, p - 1))}
              accessibilityRole="button"
              accessibilityLabel="Previous product"
              style={({ pressed }) => [styles.nav, styles.navLeft, pressed && styles.closePressed]}
            >
              <Icon name="chevron-left" color={colors.onNavy} />
            </Pressable>
          ) : null}
          {count > 1 && page < count - 1 ? (
            <Pressable
              onPress={() => setPage((p) => Math.min(count - 1, p + 1))}
              accessibilityRole="button"
              accessibilityLabel="Next product"
              style={({ pressed }) => [styles.nav, styles.navRight, pressed && styles.closePressed]}
            >
              <Icon name="chevron-right" color={colors.onNavy} />
            </Pressable>
          ) : null}

          <View style={[styles.top, { paddingTop: topInset + spacing.sm }]}>
            <AppText variant="label" style={styles.count}>
              {products.length ? `${page + 1} / ${products.length}` : ''}
            </AppText>
            <View style={styles.actions}>
              {canRotate ? (
                <Pressable
                  onPress={rotate}
                  accessibilityRole="button"
                  accessibilityLabel={landscape ? 'Rotate to portrait' : 'Rotate to landscape'}
                  style={({ pressed }) => [styles.close, pressed && styles.closePressed]}
                >
                  <Icon
                    name={landscape ? 'phone-rotate-portrait' : 'phone-rotate-landscape'}
                    color={colors.onNavy}
                  />
                </Pressable>
              ) : null}
              <Pressable
                onPress={close}
                accessibilityRole="button"
                accessibilityLabel="Close presentation"
                style={({ pressed }) => [styles.close, pressed && styles.closePressed]}
              >
                <Icon name="close" color={colors.onNavy} />
              </Pressable>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.brandNavy },
  slide: { alignItems: 'center', justifyContent: 'center' },
  image: StyleSheet.absoluteFill,
  nameOnly: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  bigName: { color: colors.onNavy, textAlign: 'center' },
  top: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: spacing.lg,
    paddingRight: spacing.sm,
  },
  count: { color: colors.onNavy },
  nav: {
    position: 'absolute',
    top: '50%',
    marginTop: -touch.min / 2,
    width: touch.min,
    height: touch.min,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  navLeft: { left: spacing.md },
  navRight: { right: spacing.md },
  actions: { flexDirection: 'row', gap: spacing.sm },
  close: {
    width: touch.min,
    height: touch.min,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  closePressed: { backgroundColor: 'rgba(255,255,255,0.28)' },
});
