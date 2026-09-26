import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

const repoRoot = __dirname

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'tools/**/*.test.mjs'],
    exclude: ['node_modules', 'out', 'release', 'tests/e2e'],
    reporters: ['default'],
    testTimeout: 30_000
  },
  resolve: {
    alias: {
      '@shared': resolve(repoRoot, 'src/shared')
    }
  }
})
