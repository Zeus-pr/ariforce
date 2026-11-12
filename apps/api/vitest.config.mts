import { defineConfig } from 'vitest/config';

// Vite 8 / oxc honours emitDecoratorMetadata from tsconfig, which NestJS DI needs.
export default defineConfig({
  oxc: { decorator: { legacy: true, emitDecoratorMetadata: true } },
  test: {
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
    testTimeout: 30000,
    // beforeAll boots the Nest app and signs in. The 10s default timed out the signup file on CI.
    hookTimeout: 60000,
    fileParallelism: false,
  },
});
