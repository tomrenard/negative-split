import { appendFileSync } from 'node:fs'
import type { IncomingMessage } from 'node:http'
import { defineConfig } from 'vite'
import { fixtureHash } from './src/field.ts'

const body = (req: IncomingMessage) =>
  new Promise<string>((resolve) => {
    let s = ''
    req.on('data', (c) => (s += c))
    req.on('end', () => resolve(s))
  })

export default defineConfig({
  server: { host: true }, // reachable from a phone on the same network, for perf.html
  plugins: [
    {
      name: 'reports',
      configureServer(server) {
        const expected = fixtureHash()
        server.middlewares.use('/report', async (req, res) => {
          const { hash, ua } = JSON.parse(await body(req))
          console.log(`${hash === expected ? 'MATCH' : 'MISMATCH'} ${hash} (node ${expected}) ${ua}`)
          res.end()
        })
        server.middlewares.use('/perf-report', async (req, res) => {
          const line = await body(req)
          appendFileSync('perf-results.jsonl', `${line}\n`)
          const r = JSON.parse(line)
          console.log(`PERF ${r.verdict} | ${r.gpu} | ${r.screen}`)
          res.end()
        })
      },
    },
  ],
})
