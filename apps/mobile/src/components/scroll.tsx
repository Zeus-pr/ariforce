/* eslint-disable no-restricted-imports -- the one place the raw scroll views are wrapped */
import { forwardRef, type ComponentProps, type ElementRef } from 'react';
import { FlatList, ScrollView as RNScrollView, SectionList } from 'react-native';
import { KeyboardAwareScrollView as RNKeyboardAwareScrollView } from 'react-native-keyboard-controller';

/**
 * App scroll views: no scroll indicators (this is an app, not a web page). Screens import
 * these instead of the react-native ones (ESLint enforces it), so new screens inherit the
 * default. A caller can still opt back in by passing the prop explicitly.
 */
const NO_BARS = {
  showsVerticalScrollIndicator: false,
  showsHorizontalScrollIndicator: false,
  // Fixed screens: no Android overscroll stretch, no iOS bounce. Pull-to-refresh is a
  // gesture-handler Pan (components/refresh.tsx), so it does not need overscroll.
  overScrollMode: 'never',
  bounces: false,
  alwaysBounceVertical: false,
} as const;

export const ScrollView = forwardRef<
  ElementRef<typeof RNScrollView>,
  ComponentProps<typeof RNScrollView>
>(function ScrollView(props, ref) {
  return <RNScrollView ref={ref} {...NO_BARS} {...props} />;
});

export function KeyboardAwareScrollView(props: ComponentProps<typeof RNKeyboardAwareScrollView>) {
  return <RNKeyboardAwareScrollView {...NO_BARS} {...props} />;
}

export function List<T>(props: ComponentProps<typeof FlatList<T>>) {
  return <FlatList<T> {...NO_BARS} {...props} />;
}

export function Sections<T, S>(props: ComponentProps<typeof SectionList<T, S>>) {
  return <SectionList<T, S> {...NO_BARS} {...props} />;
}
