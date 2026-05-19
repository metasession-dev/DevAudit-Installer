import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/plugin.ts'],
  format: ['esm'],
  target: 'node22',
  dts: false,
  sourcemap: true,
  clean: true,
  splitting: false,
  treeshake: true,
});
