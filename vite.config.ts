import { appendFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { defineConfig } from 'vite'
import { fixtureHash } from './src/field.ts'

const MAX_BODY = 16_384

// POST-only JSON endpoint; bad requests get a 400 instead of crashing the dev server.
const jsonRoute = (handle: (data: Record<string, unknown>, raw: string) => void) => (req: IncomingMessage, res: ServerResponse) => {
  if (req.method !== 'POST') return void ((res.statusCode = 405), res.end())
  let raw = ''
  req.on('data', (c) => {
    raw += c
    if (raw.length > MAX_BODY) req.destroy()
  })
  req.on('end', () => {
    try {
      handle(JSON.parse(raw), raw)
    } catch {
      res.statusCode = 400
    }
    res.end()
  })
}

export default defineConfig({
  // Localhost only. `LAN=1 pnpm dev` opens it to the local network for phone perf tests.
  server: { host: process.env.LAN ? true : 'localhost' },
  plugins: [
    {
      name: 'reports',
      configureServer(server) {
        const expected = fixtureHash()
        server.middlewares.use(
          '/report',
          jsonRoute(({ hash, ua }) => console.log(`${hash === expected ? 'MATCH' : 'MISMATCH'} ${hash} (node ${expected}) ${ua}`)),
        )
        server.middlewares.use(
          '/perf-report',
          jsonRoute((r, raw) => {
            appendFileSync('perf-results.jsonl', `${raw.replace(/\n/g, ' ')}\n`)
            console.log(`PERF ${r.verdict} | ${r.gpu} | ${r.screen}`)
          }),
        )
      },
    },
  ],
})
