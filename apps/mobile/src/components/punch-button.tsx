import * as Haptics from 'expo-haptics';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { AppText } from './app-text';
import { Icon } from './icon';
import { colors, radius, spacing } from '@/theme';

const DEPTH = 6; // height of the 3D edge, dp
const FACE_H = 56;

/**
 * Chunky 3D "pushable" button: a darker edge sits under the face; pressing sinks the face onto
 * the edge. Emerald = Punch In, vibrant red = Punch Out.
 */
export function PunchButton({
  punchedIn,
  onPress,
}: {
  punchedIn: boolean;
  onPress: () => void;
}) {
  const reduced = useReducedMotion();
  const sink = useSharedValue(0);
  const tone = punchedIn
    ? { face: colors.punchOut, edge: colors.punchOutEdge }
    : { face: colors.punchIn, edge: colors.punchInEdge };
  const label = punchedIn ? 'Punch Out' : 'Punch In';

  const faceStyle = useAnimatedStyle(() => ({ transform: [{ translateY: sink.value * DEPTH }] }));
  const press = (down: boolean) => {
    sink.value = reduced ? (down ? 1 : 0) : withTiming(down ? 1 : 0, { duration: down ? 60 : 140 });
  };

  return (
    <Pressable
      onPressIn={() => {
        press(true);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      }}
      onPressOut={() => press(false)}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={punchedIn ? 'Ends your shift' : 'Starts your shift'}
    >
      <View style={styles.wrap}>
        <View style={[styles.edge, { backgroundColor: tone.edge }]} />
        <Animated.View style={[styles.face, { backgroundColor: tone.face }, faceStyle]}>
          <View style={styles.shine} />
          <Icon name={punchedIn ? 'logout-variant' : 'login-variant'} size={24} color={colors.onNavy} />
          <AppText variant="button" style={styles.label}>
            {label}
          </AppText>
        </Animated.View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { height: FACE_H + DEPTH },
  edge: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: DEPTH,
    height: FACE_H,
    borderRadius: radius.lg,
    borderCurve: 'continuous',
  },
  face: {
    height: FACE_H,
    borderRadius: radius.lg,
    borderCurve: 'continuous',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    overflow: 'hidden',
  },
  // Soft top highlight gives the face its raised, glossy look.
  shine: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: FACE_H / 2,
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  label: { color: colors.onNavy, fontSize: 18, letterSpacing: 0.3 },
});
