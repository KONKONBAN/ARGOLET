import { build } from 'esbuild';

// Bundle the API (including workspace TS packages) into one ESM file.
// Native / WASM packages stay external and are installed at runtime.
await build({
  entryPoints: ['src/main.ts'],
  outfile: 'dist/main.mjs',
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  sourcemap: true,
  // Tesseract runs its own worker thread and WASM core, and reads the Vietnamese model from its package.
  external: [
    '@node-rs/argon2',
    '@electric-sql/pglite',
    'pg-native',
    'tesseract.js',
    '@tesseract.js-data/vie',
  ],
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
  logLevel: 'info',
});
