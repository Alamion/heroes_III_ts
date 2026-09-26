// Builds dist/ once before any test file runs. Browser suites serve the production build; when each
// file rebuilt it in its own beforeAll, files running in parallel emptied dist/ under each other and a
// page reloaded during another file's build found no script (GitHub Actions, 2026-09-26).
import { resolve } from 'node:path'

export default async function setup(): Promise<void> {
  const vite = await import('vite')
  await vite.build({ configFile: resolve(import.meta.dirname, '..', 'vite.config.ts'), logLevel: 'warn' })
}
