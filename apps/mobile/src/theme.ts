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
  navyClear: 'rgba(15, 42, 74, 0)', // navy at 0 alpha: fades to/from navy without greying
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
  success: '#15803D', // 5:1 on white, for text
  successWash: '#E8F6EC',
  info: '#2563C9', // 5:1 on infoWash, for text and icons
  infoWash: '#EAF1FD',
  infoWashPressed: '#D9E6FB',
  warn: '#C2410C', // 4.8:1 on warnWash
  warnWash: '#FFF1E8',
  onNavy: '#FFFFFF',
  glassTint: 'rgba(255, 255, 255, 0.45)', // white wash over the blur, keeps icons readable
  glassFallback: 'rgba(255, 255, 255, 0.9)', // no native blur (Android, Expo Go): frosted white
  glassBorder: 'rgba(15, 42, 74, 0.10)', // hairline that separates the glass from white cards
} as const;

/** Icon tints: foreground on its own wash. Every pair is at least 3:1 (icons) or 4.5:1 (text). */
export const tones = {
  teal: { fg: colors.tealDeep, bg: colors.tealWash },
  blue: { fg: colors.info, bg: colors.infoWash },
  orange: { fg: colors.warn, bg: colors.warnWash },
  green: { fg: colors.success, bg: colors.successWash },
  red: { fg: colors.danger, bg: colors.dangerWash },
  neutral: { fg: colors.muted, bg: colors.ground },
} as const;

export type Tone = keyof typeof tones;

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

/** Fixed component sizes (dp). */
export const sizes = {
  avatar: 36,
  avatarLg: 56,
  iconTile: 40, // tinted icon square in cards and rows
  iconTileLg: 48, // quick-action tiles
  badge: 8, // unread dot
  progress: 6, // KPI progress track
  row: 72, // every list row: icon tile + one-line title + one-line subtitle
  tile: 96, // quick-action tiles
  tabBar: 64, // floating tab bar height
  header: 56, // header row under the status bar (Material top app bar)
  readable: 320, // max width of centred copy (empty and coming-soon states)
} as const;

/** Screen rhythm: one gutter for every screen edge, one gap between sections, one inside them. */
export const layout = {
  gutter: spacing.lg,
  section: spacing.xl,
  inner: spacing.md, // section title to content, and between cards in a grid
  tabBarInset: spacing.lg, // floating bar distance from the screen sides
  tabBarLift: spacing.sm, // floating bar distance above the safe area / gesture bar
} as const;

/** Frosted tab bar: expo-blur settings (Android intensity is divided by blurReductionFactor 4). */
export const glass = { tint: 'light', intensity: 60 } as const;

export const iconSize = { sm: 18, md: 22, lg: 24 } as const;

/** boxShadow strings (not legacy shadow/elevation props); navy-tinted, low. */
export const shadows = {
  card: '0 1px 2px rgba(15, 42, 74, 0.06), 0 4px 12px rgba(15, 42, 74, 0.05)',
  floating: '0 2px 6px rgba(15, 42, 74, 0.08), 0 10px 28px rgba(15, 42, 74, 0.16)',
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
    fontSize: 28,
    lineHeight: 34,
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
  avatar: { fontFamily: fonts.semibold, fontSize: 15, lineHeight: 20, color: colors.onNavy },
  avatarLg: { fontFamily: fonts.semibold, fontSize: 22, lineHeight: 28, color: colors.onNavy },
  section: { fontFamily: fonts.semibold, fontSize: 18, lineHeight: 24, color: colors.ink },
  kpi: {
    fontFamily: fonts.bold,
    fontSize: 24,
    lineHeight: 30,
    letterSpacing: -0.3,
    color: colors.ink,
  },
  count: { fontFamily: fonts.bold, fontSize: 20, lineHeight: 26, color: colors.ink },
  rowTitle: { fontFamily: fonts.medium, fontSize: 16, lineHeight: 21, color: colors.ink },
  small: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, color: colors.muted },
  chip: { fontFamily: fonts.medium, fontSize: 12, lineHeight: 16, color: colors.ink },
  action: { fontFamily: fonts.medium, fontSize: 13, lineHeight: 17, color: colors.ink },
} as const satisfies Record<string, TextStyle>;

export type TypeVariant = keyof typeof type;

/** Tab bar label: no colour here, the tab bar tints it (active navy, inactive muted). */
export const tabLabel = { fontFamily: fonts.semibold, fontSize: 13, lineHeight: 18 } as const;

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
