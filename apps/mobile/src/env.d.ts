/// <reference types="expo/types" />

/** Metro turns a static image import into an asset id (works with expo-image and RN Image). */
declare module '*.png' {
  const asset: number;
  export default asset;
}

declare module '*.ttf' {
  const font: import('expo-font').FontSource;
  export default font;
}
