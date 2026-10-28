import { Text, type TextProps } from 'react-native';
import { type, type TypeVariant } from '@/theme';

/** The only way screens set type: a named step of the ramp in theme.ts. */
export function AppText({
  variant = 'body',
  style,
  ...props
}: TextProps & { variant?: TypeVariant }) {
  return <Text {...props} style={[type[variant], style]} />;
}
