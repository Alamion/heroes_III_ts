/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import preact from '@preact/preset-vite'
import { promises as fs } from 'fs'
import path from 'path'



// https://vite.dev/config/
export default defineConfig({
  plugins: [
    preact(),
    {
      name: 'copy-project-json',
      closeBundle: async () => {
        await fs.copyFile(
          path.resolve(__dirname, 'project.json'),
          path.resolve(__dirname, 'dist', 'project.json')
        )
      },
    },
  ],
  base: './',
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
    },
  },
  server: {
    fs: {
      allow: ['..'],
    },
    headers: {
      'Access-Control-Allow-Origin': '*',
    },
  },
  optimizeDeps: {
    exclude: ['fflate', 'pako'],
  },
})
