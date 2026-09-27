// server/src/index.js — production entry: pool from DATABASE_URL, listen.
import { createApp } from './app.js'
import { defaultPool } from './db/pool.js'

const port = Number(process.env.PORT) || 8080
const app = createApp({ pool: defaultPool, rateLimits: process.env.RATE_LIMITS !== 'off' })

const server = app.listen(port, () => {
  console.log(`alleadz listening on :${port}`)
})

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(1), 5000).unref()
  })
}
