import { defineConfig } from 'vite'
import { fixtureHash } from './src/field.ts'

export default defineConfig({
  plugins: [
    {
      name: 'determinism-report',
      configureServer(server) {
        const expected = fixtureHash()
        server.middlewares.use('/report', (req, res) => {
          let body = ''
          req.on('data', (c) => (body += c))
          req.on('end', () => {
            const { hash, ua } = JSON.parse(body)
            console.log(`${hash === expected ? 'MATCH' : 'MISMATCH'} ${hash} (node ${expected}) ${ua}`)
            res.end()
          })
        })
      },
    },
  ],
})
