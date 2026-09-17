// Minimal static file server for host simulations: serves a folder under a path prefix on
// 127.0.0.1 (web: the GitHub Pages sub-path; Lively: the wallpaper folder on a *.localhost host).

import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import { extname, join, normalize, resolve } from 'node:path'

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
}

export interface StaticServer {
  port: number
  close(): Promise<void>
}

export function serveStatic(root: string, prefix = '/'): Promise<StaticServer> {
  const base = resolve(root)
  const server: Server = createServer((req, res) => {
    let path: string
    try {
      path = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname)
    } catch {
      res.statusCode = 400
      res.end()
      return
    }
    if (!path.startsWith(prefix)) {
      res.statusCode = 404
      res.end()
      return
    }
    let file = normalize(join(base, path.slice(prefix.length)))
    if (!file.startsWith(base)) {
      res.statusCode = 403
      res.end()
      return
    }
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html')
    if (!existsSync(file)) {
      res.statusCode = 404
      res.end()
      return
    }
    res.setHeader('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream')
    res.setHeader('Content-Length', String(statSync(file).size))
    createReadStream(file).pipe(res)
  })
  return new Promise((resolveServer, reject) => {
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (address === null || typeof address === 'string') {
        reject(new Error('static server has no port'))
        return
      }
      resolveServer({ port: address.port, close: () => new Promise((r) => server.close(() => r())) })
    })
  })
}
