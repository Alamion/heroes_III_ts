/// <reference types="vitest/config" />
import { rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'

const repoRoot = import.meta.dirname
const harnessRoot = resolve(repoRoot, 'src/adapters/dev-harness')

// The dev harness is the Vite root so `yarn dev` serves it at `/`. The build emits the harness
// page and the render page used by headless checks (contracts/engine-api.md).
export default defineConfig(({ command }) => ({
  root: harnessRoot,
  base: './',
  // public/ holds git-ignored game files for development; never copy it into build output
  // (constitution Principle I).
  publicDir: command === 'serve' ? resolve(repoRoot, 'public') : false,
  plugins: [
    {
      // dist/packages holds `yarn package` output: clean only the harness outputs.
      name: 'h3-clean-harness-output',
      apply: 'build',
      buildStart() {
        for (const p of ['assets', 'index.html', 'render.html']) rmSync(resolve(repoRoot, 'dist', p), { recursive: true, force: true })
      },
    },
  ],
  build: {
    outDir: resolve(repoRoot, 'dist'),
    emptyOutDir: false,
    target: 'es2022',
    rollupOptions: {
      input: {
        index: resolve(harnessRoot, 'index.html'),
        render: resolve(harnessRoot, 'render.html'),
      },
    },
  },
  worker: {
    format: 'es',
  },
  server: {
    fs: { allow: [repoRoot] },
  },
  test: {
    root: repoRoot,
    globals: false,
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // dist/ is built once here; browser suites must not rebuild it (see the file).
    globalSetup: ['test/global-setup.ts'],
    testTimeout: 60_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/core/**/*.ts'],
    },
  },
}))
