/// <reference types="expo/types" />

declare module '*.png' {
  const source: import('react-native').ImageSourcePropType;
  export default source;
}
