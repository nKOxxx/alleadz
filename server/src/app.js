// server/src/app.js
// Express application factory. Tests spin it up on ephemeral ports with an
// injected pool; index.js listens in production.
//
//   createApp({ pool, logger }) -> express app
//
// /health is registered before auth middleware (unauthenticated liveness).
// Everything under /api requires a bearer token; tenant routes additionally
// require X-Tenant-Id with verified membership (middleware/auth.js).

import express from 'express'
import { createErrorHandler } from './lib/errors.js'
import { securityHeaders } from './middleware/security-headers.js'
import { createRateLimiter, createAuthRateLimiter } from './middleware/rate-limit.js'
import { createAuthRouter } from './routes/auth.js'
import { createOrgsRouter } from './routes/orgs.js'
import { createImportsRouter } from './routes/imports.js'
import { createOpportunitiesRouter } from './routes/opportunities.js'
import { createPeopleRouter } from './routes/people.js'
import { createDiscoveryRouter } from './routes/discovery.js'
import { createPortfolioRouter } from './routes/portfolio.js'

export function createApp({ pool, logger = console, rateLimits = true, fetchImpl } = {}) {
  if (!pool) throw new Error('createApp requires a pg pool')
  const app = express()
  app.disable('x-powered-by')
  app.set('trust proxy', true)

  app.use(securityHeaders)
  app.use(express.json({ limit: '256kb' }))

  app.get(['/health', '/api/health'], (req, res) => {
    res.json({ ok: true })
  })

  app.use(createRateLimiter({ windowMs: 60_000, max: 300 }))
  const authLimiter = rateLimits ? createAuthRateLimiter() : (req, res, next) => next()
  app.use(createAuthRouter({ pool }))
  // /api namespace: same auth router (login at /api/auth/login too) plus the
  // tenant-scoped routers. Tests and the client both exercise /api/*.
  app.use('/api', authLimiter, createAuthRouter({ pool }))
  app.use('/api', createOrgsRouter({ pool }))
  app.use('/api', createImportsRouter({ pool }))
  app.use('/api', createOpportunitiesRouter({ pool }))
  app.use('/api', createPeopleRouter({ pool }))
  app.use('/api', createDiscoveryRouter({ pool, fetchImpl }))
  app.use('/api', createIntelligenceRouter({ pool }))
  app.use('/api', createPortfolioRouter({ pool }))

  app.use((req, res) => {
    res.status(404).json({ error: { code: 'not_found', message: 'Unknown route' } })
  })

  app.use(createErrorHandler(logger))
  return app
}
import { createIntelligenceRouter } from './routes/intelligence.js'
