import { defineConfig } from 'vite';

// Bundles the API into one self-contained ES module for Vercel: api/index.js.
// One file avoids Node's rule that ES module imports need file extensions, and
// keeps the old src/*.js stubs out of the function.
export default defineConfig({
  resolve: { extensions: ['.ts', '.json', '.js'] },
  build: {
    ssr: 'server/vercel.ts',
    outDir: 'api',
    emptyOutDir: false,
    minify: false,
    sourcemap: false,
    target: 'node20',
    rollupOptions: {
      output: { entryFileNames: 'index.js', format: 'es' },
    },
  },
});
