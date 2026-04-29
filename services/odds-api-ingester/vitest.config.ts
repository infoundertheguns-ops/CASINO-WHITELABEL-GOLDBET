import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Override PostCSS to an empty inline config so Vite does NOT walk up the
  // tree and discover the parent admin app's postcss.config.js (which would
  // fail to load tailwindcss from this service's node_modules).
  css: {
    postcss: {
      plugins: [],
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.ts'],
  },
});
