// Local production-artifact server; mirrors the filesystem + 404 Vercel rules.
import { createServer } from 'node:http'
import { readFileSync, statSync } from 'node:fs'
import { resolve, extname, sep } from 'node:path'
const root = resolve('dist')
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' }
createServer((req, res) => {
  let file, status = 200
  try {
    const url = new URL(req.url, 'http://localhost')
    file = resolve(root, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname))
    if (!file.startsWith(root + sep) || !statSync(file).isFile()) throw new Error('Not found')
  } catch { file = resolve(root, '404.html'); status = 404 }
  res.writeHead(status, { 'Content-Type': types[extname(file)] || 'application/octet-stream' })
  res.end(readFileSync(file))
}).listen(4177, '127.0.0.1')
