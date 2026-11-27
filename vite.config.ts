import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import tailwindcss from '@tailwindcss/vite';

/** Moves built stylesheet links ahead of module scripts so WebView parses CSS without waiting behind JS preloads. */
function prioritizeStylesheetInHead(): Plugin {
  return {
    name: 'prioritize-stylesheet-in-head',
    enforce: 'post',
    transformIndexHtml(html) {
      const stylesheetRe = /<link\b[^>]*rel=["']stylesheet["'][^>]*>\s*/gi;
      const stylesheets = html.match(stylesheetRe);
      if (!stylesheets?.length) return html;
      const stripped = html.replace(stylesheetRe, '');
      const insertTarget = /(<(?:script\b[^>]*type=["']module["']|link\b[^>]*rel=["']modulepreload["']))/i;
      if (!insertTarget.test(stripped)) return html;
      return stripped.replace(insertTarget, `${stylesheets.join('')}$1`);
    },
  };
}

// https://vite.dev/config/
export default defineConfig(({ command, mode }) => {
  const isBuild = command === 'build';
  return {
    plugins: [react(), tailwindcss(), prioritizeStylesheetInHead()],
    base: mode === 'desktop' || mode === 'android' ? './' : '/',
    define: isBuild
      ? {
          'import.meta.env.DEV': 'false',
          'import.meta.env.PROD': 'true',
        }
      : undefined,
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules/pdfjs-dist')) {
              return 'vendor-pdfjs';
            }
            if (id.includes('node_modules/pdf-lib')) {
              return 'vendor-pdflib';
            }
            if (
              id.includes('node_modules/react/') ||
              id.includes('node_modules/react-dom/') ||
              id.includes('node_modules/react-router/') ||
              id.includes('node_modules/react-router-dom/')
            ) {
              return 'vendor-react';
            }
            if (id.includes('node_modules/lucide-react')) {
              return 'vendor-lucide';
            }
          },
        },
      },
    },
  };
});

