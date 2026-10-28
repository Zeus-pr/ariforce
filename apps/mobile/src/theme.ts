/** AriForce mobile tokens. Navy ink + teal accent from the logo mark, on a soft blue-white ground. */
export const colors = {
  navy: '#0F2A4A',
  navyPressed: '#0B1F37',
  brandNavy: '#162D5A', // the logo's own navy
  teal: '#0CAAC1',
  tealDeep: '#0C8498',
  tealSoft: '#BFE8EF',
  ground: '#F4F8FD',
  surface: '#FFFFFF',
  ink: '#0F2A4A',
  muted: '#5B6B80',
  subtle: '#8592A3',
  border: '#DCE4EE',
  borderStrong: '#B8C5D6',
  danger: '#B42318',
  dangerSoft: '#FEF3F2',
  dangerBorder: '#FBD5D0',
  onNavy: '#FFFFFF',
} as const;

export const fonts = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
} as const;

export const radius = { sm: 8, md: 12, lg: 16, pill: 999 } as const;
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

/** Strong ease-out (cubic-bezier(0.23, 1, 0.32, 1)) for entrances and press feedback. */
export const EASE_OUT: [number, number, number, number] = [0.23, 1, 0.32, 1];
