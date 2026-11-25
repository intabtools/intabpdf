import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config.ts';

export default defineConfig((env) => {
  const baseConfig = typeof viteConfig === 'function' ? viteConfig(env) : viteConfig;
  return mergeConfig(baseConfig, {
    test: {
      exclude: ['**/node_modules/**', '**/dist/**', '**/e2e/**', '**/.{idea,git,cache,output,temp}/**'],
    },
  });
});
