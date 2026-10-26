import { defineConfig } from 'vitest/config';

// Vite 8 / oxc honours emitDecoratorMetadata from tsconfig, which NestJS DI needs.
export default defineConfig({
  oxc: { decorator: { legacy: true, emitDecoratorMetadata: true } },
  test: {
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
    testTimeout: 30000,
    fileParallelism: false,
  },
});
