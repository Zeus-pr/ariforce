/* eslint-disable no-restricted-imports -- the one place the raw scroll views are wrapped */
import type { ComponentProps } from 'react';
import { FlatList, ScrollView as RNScrollView, SectionList } from 'react-native';
import { KeyboardAwareScrollView as RNKeyboardAwareScrollView } from 'react-native-keyboard-controller';

/**
 * App scroll views: no scroll indicators (this is an app, not a web page). Screens import
 * these instead of the react-native ones (ESLint enforces it), so new screens inherit the
 * default. A caller can still opt back in by passing the prop explicitly.
 */
const NO_BARS = { showsVerticalScrollIndicator: false, showsHorizontalScrollIndicator: false };

export function ScrollView(props: ComponentProps<typeof RNScrollView>) {
  return <RNScrollView {...NO_BARS} {...props} />;
}

export function KeyboardAwareScrollView(props: ComponentProps<typeof RNKeyboardAwareScrollView>) {
  return <RNKeyboardAwareScrollView {...NO_BARS} {...props} />;
}

export function List<T>(props: ComponentProps<typeof FlatList<T>>) {
  return <FlatList<T> {...NO_BARS} {...props} />;
}

export function Sections<T, S>(props: ComponentProps<typeof SectionList<T, S>>) {
  return <SectionList<T, S> {...NO_BARS} {...props} />;
}
