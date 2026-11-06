import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // The obsidian package ships types only. Keeping a real file behind the
    // specifier lets jsdom bundles resolve it; the tests mock the module.
    alias: {
      obsidian: new URL('./tests/obsidianStub.ts', import.meta.url).pathname,
    },
  },
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['tests/setup.ts'],
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts']
    }
  },
});
