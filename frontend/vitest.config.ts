import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'happy-dom',
      globals: true,
      setupFiles: ['./src/test/setup.ts'],
      // Smoke-test scope only — point at the test files we explicitly write.
      // No glob over the whole tree to keep wall-clock fast and avoid surprises
      // from page snapshots being treated as tests.
      include: ['src/**/*.test.{ts,tsx}'],
      css: false,
    },
  }),
);
