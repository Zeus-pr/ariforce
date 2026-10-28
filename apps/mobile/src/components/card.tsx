import { StyleSheet, View, type ViewProps } from 'react-native';
import { colors, radius, shadows } from '@/theme';

/** White surface on the blue-white ground. */
export function Card({ style, ...props }: ViewProps) {
  return <View {...props} style={[cardStyles.card, style]} />;
}

export const cardStyles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderCurve: 'continuous',
    boxShadow: shadows.card,
  },
});
