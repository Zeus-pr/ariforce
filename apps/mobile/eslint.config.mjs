import base from '@ariforce/config/eslint';

const SPINNER_MSG =
  'No spinners in the app: show a skeleton from @/components/skeleton (Skeleton, SkeletonList, …).';
const SCROLL_MSG = 'Use the wrappers in @/components/scroll (no scroll indicators in the app).';

export default [
  ...base,
  { ignores: ['.expo/**', 'android/**', 'ios/**', 'expo-env.d.ts', 'dist/**'] },
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'react-native',
              importNames: ['ScrollView', 'FlatList', 'SectionList', 'VirtualizedList'],
              message: SCROLL_MSG,
            },
            { name: 'react-native', importNames: ['ActivityIndicator'], message: SPINNER_MSG },
            {
              name: 'react-native-keyboard-controller',
              importNames: ['KeyboardAwareScrollView'],
              message: SCROLL_MSG,
            },
            {
              name: 'react-native-gesture-handler',
              importNames: ['ScrollView', 'FlatList', 'SectionList'],
              message: SCROLL_MSG,
            },
          ],
        },
      ],
    },
  },
];
