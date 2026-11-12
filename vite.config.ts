import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative asset paths, so the build works on GitHub Pages' /zm-paye/ path
  // and at the root of Cloudflare Pages or a custom domain.
  base: './',
  // TypeScript first: the old one-line src/*.js stubs share these module names.
  resolve: { extensions: ['.ts', '.json', '.js'] },
  test: {
    include: ['test/**/*.test.ts'],
  },
});
