import { defineConfig } from 'tsup';

export default defineConfig({
  // Two entry points: the pure core (`.`) and the Node-only helpers (`./node`).
  entry: { index: 'src/index.ts', 'node/index': 'src/node/index.ts' },
  format: ['esm'],
  target: 'node22',
  // Declarations come from `tsc --emitDeclarationOnly` (see package.json `build`), as in
  // plugin-sdk: tsup's vendored dts bundler predates TypeScript 7 (devaudit-installer#376).
  dts: false,
  sourcemap: true,
  clean: true,
  splitting: false,
  treeshake: true,
});
