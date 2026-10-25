import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';

// https://vite.dev/config/
export default defineConfig(({ command, mode }) => {
  const isBuild = command === 'build';
  return {
    plugins: [react(), tailwindcss()],
    base: mode === 'desktop' ? './' : '/',
    define: isBuild
      ? {
          'import.meta.env.DEV': 'false',
          'import.meta.env.PROD': 'true',
        }
      : undefined,
  };
});

