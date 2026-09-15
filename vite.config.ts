/// <reference types="vitest/config" />
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
  build: {
    outDir: resolve(repoRoot, 'dist'),
    emptyOutDir: true,
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
    testTimeout: 60_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/core/**/*.ts'],
    },
  },
}))
