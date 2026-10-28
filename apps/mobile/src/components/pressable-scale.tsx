import * as Haptics from 'expo-haptics';
import type { ReactNode } from 'react';
import {
  Pressable,
  type GestureResponderEvent,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, { useReducedMotion } from 'react-native-reanimated';
import { motion } from '@/theme';

type Props = Omit<PressableProps, 'style' | 'children'> & {
  children: ReactNode;
  /** Outer layout (flex, width) for the touch area. */
  containerStyle?: StyleProp<ViewStyle>;
  /** The visual surface that scales. */
  style?: StyleProp<ViewStyle>;
  pressedStyle?: StyleProp<ViewStyle>;
  scaleTo?: number;
  /** Light selection tick on press (default on). */
  haptic?: boolean;
};

/**
 * Tappable surface with press-in feedback: scale (0.97 by default) as a Reanimated CSS transition,
 * 120 ms strong ease-out, off under Reduce Motion. Optional pressed fill via pressedStyle.
 */
export function PressableScale({
  children,
  containerStyle,
  style,
  pressedStyle,
  scaleTo = 0.97,
  haptic = true,
  onPress,
  accessibilityRole = 'button',
  ...rest
}: Props) {
  const reduced = useReducedMotion();

  function handlePress(e: GestureResponderEvent) {
    if (haptic) Haptics.selectionAsync().catch(() => {});
    onPress?.(e);
  }

  return (
    <Pressable
      {...rest}
      accessibilityRole={accessibilityRole}
      onPress={handlePress}
      pressRetentionOffset={16}
      style={containerStyle}
    >
      {({ pressed }) => (
        <Animated.View
          style={[
            style,
            pressed && pressedStyle,
            {
              transform: [{ scale: pressed && !reduced ? scaleTo : 1 }],
              transitionProperty: 'transform',
              transitionDuration: motion.press,
              transitionTimingFunction: motion.cssEaseOut,
            },
          ]}
        >
          {children}
        </Animated.View>
      )}
    </Pressable>
  );
}
