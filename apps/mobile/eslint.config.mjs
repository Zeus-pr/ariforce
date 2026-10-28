import base from '@ariforce/config/eslint';

export default [
  ...base,
  { ignores: ['.expo/**', 'android/**', 'ios/**', 'expo-env.d.ts', 'dist/**'] },
];
