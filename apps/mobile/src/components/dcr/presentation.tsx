import { Image } from 'expo-image';
import { useCallback, useEffect, useState } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText } from '@/components/app-text';
import { Icon } from '@/components/icon';
import { List } from '@/components/scroll';
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
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [page, setPage] = useState(0);
  const [landscape, setLandscape] = useState(false);
  // Hidden when this binary has no expo-screen-orientation (built before it was added).
  const canRotate = getScreenOrientation() != null;

  useEffect(() => {
    if (visible) {
      setPage(0);
      setLandscape(false);
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

  const onEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) =>
    setPage(Math.round(e.nativeEvent.contentOffset.x / Math.max(1, width)));

  return (
    <Modal
      visible={visible}
      animationType="fade"
      onRequestClose={close}
      supportedOrientations={['portrait', 'landscape']}
      statusBarTranslucent
      navigationBarTranslucent
    >
      <View style={styles.root}>
        <List
          // Re-layout on rotate: remount at the new width, starting on the current slide.
          key={`w${Math.round(width)}`}
          initialScrollIndex={Math.min(page, Math.max(0, products.length - 1))}
          data={products}
          horizontal
          pagingEnabled
          keyExtractor={(p) => p.id}
          getItemLayout={(_, index) => ({ length: width, offset: width * index, index })}
          onMomentumScrollEnd={onEnd}
          renderItem={({ item, index }) => (
            <View
              style={[
                styles.slide,
                {
                  width,
                  height,
                  paddingTop: insets.top + touch.min + spacing.lg,
                  paddingBottom: insets.bottom + spacing.xxl * 2,
                  paddingLeft: insets.left + spacing.lg,
                  paddingRight: insets.right + spacing.lg,
                },
              ]}
              accessible
              accessibilityLabel={`${doctorProductLabel(item)}, product ${index + 1} of ${products.length}`}
            >
              {item.imageUrl ? (
                <>
                  <Image
                    source={{ uri: item.imageUrl }}
                    style={styles.image}
                    contentFit="contain"
                    transition={120}
                  />
                  <AppText variant="title" style={styles.caption} numberOfLines={2}>
                    {doctorProductLabel(item)}
                  </AppText>
                </>
              ) : (
                <View style={styles.nameOnly}>
                  <AppText variant="display" style={styles.bigName}>
                    {doctorProductLabel(item)}
                  </AppText>
                </View>
              )}
            </View>
          )}
        />

        <View style={[styles.top, { paddingTop: insets.top + spacing.sm }]}>
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

        <View
          style={[styles.dots, { bottom: insets.bottom + spacing.xl }]}
          accessibilityLabel={`Product ${page + 1} of ${products.length}`}
        >
          {products.map((p, i) => (
            <View key={p.id} style={[styles.dot, i === page && styles.dotOn]} />
          ))}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.brandNavy },
  slide: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.lg },
  image: { flex: 1, width: '100%', borderRadius: radius.lg },
  caption: { color: colors.onNavy, textAlign: 'center', marginTop: spacing.lg },
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
  dots: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    flexWrap: 'wrap',
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: radius.full,
    margin: spacing.xs,
    backgroundColor: 'rgba(255,255,255,0.35)',
  },
  dotOn: { width: 20, backgroundColor: colors.onNavy },
});
