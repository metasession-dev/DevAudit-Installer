import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Windows runners are slow at spawning git/bash: several subprocess-heavy tests
    // (doctor --fix, the close-out/gate workflow behaviour tests) took 5-8s there and
    // flaked against vitest's 5s default. 30s keeps a real hang failing, not a slow runner.
    testTimeout: 30_000,
    include: ['test/**/*.test.ts'],
    globalSetup: ['test/global-setup.ts'],
    setupFiles: ['test/setup-viewer-keys.ts'],
    coverage: {
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
    },
  },
});
