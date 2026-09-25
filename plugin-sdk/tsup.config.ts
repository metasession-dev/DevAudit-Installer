import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node22',
  // devaudit-installer#376 — tsup 8.5.1 vendors its own internal copy of
  // rollup-plugin-dts (pinned against typescript@5.7.3 at publish time,
  // independent of this project's own typescript version) to do DTS
  // bundling. It crashes under TypeScript 7
  // ("Cannot read properties of undefined (reading 'useCaseSensitiveFileNames')")
  // because that vendored copy predates TS7's internal API changes, and no
  // project-level override/resolution can reach a dependency bundled
  // inside tsup's own published package. Declarations are emitted by `tsc
  // --emitDeclarationOnly` instead (see package.json's `build` script) —
  // ordinary per-module .d.ts files that re-export correctly, not a single
  // bundled dist/index.d.ts, but functionally equivalent for consumers.
  dts: false,
  sourcemap: true,
  clean: true,
  splitting: false,
  treeshake: true,
});
