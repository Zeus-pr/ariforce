/**
 * AriForce mobile design tokens: the single theme entry point (expo-design-system).
 * Navy ink + logo teal on a soft blue-white ground, Google Sans (the website's face).
 * Light only for now: the mockups and brand are light (app.json userInterfaceStyle "light").
 * Screens import components; components import these tokens. No hex, font size, radius or
 * shadow literal belongs outside this file.
 */
import { cubicBezier, Easing } from 'react-native-reanimated';
import type { TextStyle } from 'react-native';

export const colors = {
  navy: '#0F2A4A',
  navyPressed: '#0B1F37',
  brandNavy: '#162D5A', // the logo's own navy, for the wordmark
  teal: '#0CAAC1',
  tealDeep: '#0C8498', // teal that passes 4.5:1 on white, for text and focus
  tealSoft: '#BFE8EF',
  tealWash: '#E8F6F9',
  tealInk: '#24485F', // body text on tealWash
  ground: '#F4F8FD',
  surface: '#FFFFFF',
  ink: '#0F2A4A',
  muted: '#55667B',
  subtle: '#7D8A9B',
  separator: '#DCE4EE',
  borderStrong: '#B8C5D6',
  danger: '#B42318',
  dangerWash: '#FEF3F2',
  dangerBorder: '#FBD5D0',
  onNavy: '#FFFFFF',
} as const;

/** Font family per weight (static files, so never set fontWeight with them). */
export const fonts = {
  regular: 'GoogleSans-Regular',
  medium: 'GoogleSans-Medium',
  semibold: 'GoogleSans-SemiBold',
  bold: 'GoogleSans-Bold',
} as const;

/** 4-point spacing scale. Row gap < group gap < section gap. */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

export const radius = { sm: 8, md: 12, lg: 16, full: 9999 } as const;

/** boxShadow strings (not legacy shadow/elevation props); navy-tinted, low. */
export const shadows = {
  card: '0 1px 2px rgba(15, 42, 74, 0.06), 0 4px 12px rgba(15, 42, 74, 0.05)',
} as const;

/** Named text styles (type ramp). Screens use <AppText variant=…>, never raw font sizes. */
export const type = {
  display: {
    fontFamily: fonts.bold,
    fontSize: 40,
    lineHeight: 46,
    letterSpacing: -0.8,
    color: colors.brandNavy,
  },
  title: {
    fontFamily: fonts.bold,
    fontSize: 30,
    lineHeight: 36,
    letterSpacing: -0.6,
    color: colors.ink,
  },
  name: {
    fontFamily: fonts.bold,
    fontSize: 32,
    lineHeight: 38,
    letterSpacing: -0.6,
    color: colors.ink,
  },
  greeting: { fontFamily: fonts.regular, fontSize: 20, lineHeight: 26, color: colors.muted },
  headline: { fontFamily: fonts.semibold, fontSize: 17, lineHeight: 22, color: colors.ink },
  body: { fontFamily: fonts.regular, fontSize: 16, lineHeight: 22, color: colors.ink },
  bodyMuted: { fontFamily: fonts.regular, fontSize: 16, lineHeight: 22, color: colors.muted },
  label: { fontFamily: fonts.medium, fontSize: 15, lineHeight: 20, color: colors.ink },
  button: { fontFamily: fonts.semibold, fontSize: 16, lineHeight: 20, color: colors.ink },
  subhead: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 21, color: colors.muted },
  caption: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 19, color: colors.muted },
  tagline: {
    fontFamily: fonts.medium,
    fontSize: 15,
    lineHeight: 20,
    letterSpacing: 2.4,
    color: colors.muted,
  },
  company: {
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 18,
    letterSpacing: 1.2,
    color: colors.subtle,
  },
  wordmarkSm: {
    fontFamily: fonts.bold,
    fontSize: 20,
    lineHeight: 24,
    letterSpacing: -0.3,
    color: colors.brandNavy,
  },
  avatar: { fontFamily: fonts.semibold, fontSize: 14, lineHeight: 18, color: colors.onNavy },
} as const satisfies Record<string, TextStyle>;

export type TypeVariant = keyof typeof type;

/** Motion (expo-animation / emil-design-eng): strong ease-out, short UI durations. */
export const motion = {
  press: 120, // press feedback
  fast: 180, // small state change
  base: 260, // enter / exit
  splashMin: 1100, // brand splash never flashes
  fontFailsafe: 2500, // CUTLY: never block launch on fonts longer than this
  cssEaseOut: cubicBezier(0.23, 1, 0.32, 1), // Reanimated CSS transitions/animations
  easeOut: Easing.bezier(0.23, 1, 0.32, 1), // withTiming / layout animations
} as const;

/** Touch targets: 48dp Android minimum (44pt iOS). */
export const touch = { min: 48, control: 52 } as const;
