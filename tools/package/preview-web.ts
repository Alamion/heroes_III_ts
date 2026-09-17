// yarn preview:web — serves dist/packages/web under /heroes_III_ts/, as GitHub Pages does.

import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { serveStatic } from '../checks/hosts/static-server.ts'

const dir = resolve('dist/packages/web')
if (!existsSync(dir)) {
  process.stderr.write('dist/packages/web is missing: run yarn package --host web first\n')
  process.exit(3)
}
const server = await serveStatic(dir, '/heroes_III_ts/')
process.stderr.write(`http://127.0.0.1:${server.port}/heroes_III_ts/  (Ctrl+C to stop)\n`)
