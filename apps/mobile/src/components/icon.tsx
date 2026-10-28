import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { ComponentProps } from 'react';
import { colors, iconSize } from '@/theme';

type IconProps = ComponentProps<typeof MaterialCommunityIcons>;
export type IconName = IconProps['name'];
/** Whatever colour the icon font accepts (tab bars pass ColorValue; numbers are not allowed). */
export type IconColor = IconProps['color'];

/**
 * One icon family app-wide (Material Community, JS + font, runs in Expo Go). Icons are
 * decorative: the control around them carries the accessibility label.
 */
export function Icon({
  name,
  size = iconSize.md,
  color = colors.ink,
}: {
  name: IconName;
  size?: number;
  color?: IconColor | null;
}) {
  return (
    <MaterialCommunityIcons
      name={name}
      size={size}
      color={color ?? colors.ink}
      accessible={false}
      importantForAccessibility="no"
    />
  );
}

export const iconFont = MaterialCommunityIcons.font;
