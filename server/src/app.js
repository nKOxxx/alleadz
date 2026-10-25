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
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
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
import { createVerticalsRouter } from './routes/verticals.js'
import { createAnalyst } from './lib/analyst.js'

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
  app.use('/api', createIntelligenceRouter({ pool, analyst: createAnalyst({
    apiKey: process.env.DEEPSEEK_API_KEY,
    baseUrl: process.env.ANALYST_BASE_URL || undefined,
    model: process.env.ANALYST_MODEL || undefined,
    fetchImpl,
  }) }))
  app.use('/api', createPortfolioRouter({ pool }))
  app.use('/api', createVerticalsRouter({ pool }))

  // ---- static client (v1.0) ------------------------------------------------
  // Serve the built SPA from ../client/dist when present (same-origin, so the
  // client's relative /api + /auth fetches just work — no CORS). Absent dist
  // (fresh clones, tests) -> behavior unchanged: 404 JSON, exactly as before.
  const clientDist = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)), '../../client/dist')
  if (fs.existsSync(path.join(clientDist, 'index.html'))) {
    // The global API-grade CSP (default-src 'none') would block the SPA's module
    // script, stylesheet and same-origin fetches. Serve a real app CSP on the
    // shell + assets instead; API/auth routes keep the hardened default below.
    const SPA_CSP = [
      "default-src 'self'",
      // vite builds emit no inline scripts; React Router needs connect-src self,
      // twenty-ui toasts use inline styles, fontsource ships self-hosted fonts.
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; ')
    const shellCsp = (req, res, next) => {
      res.setHeader('Content-Security-Policy', SPA_CSP)
      next()
    }
    app.use(express.static(clientDist, {
      index: 'index.html',
      maxAge: '1h',
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html')) {
          res.setHeader('Content-Security-Policy', SPA_CSP)
          res.setHeader('Cache-Control', 'no-store')
        }
      },
    }))
    // SPA fallback: any non-API GET serves the shell so client-side routes deep-link.
    app.get('*', shellCsp, (req, res, next) => {
      if (req.path.startsWith('/api') || req.path.startsWith('/auth') || req.path === '/health') {
        return next()
      }
      res.setHeader('Cache-Control', 'no-store')
      res.sendFile(path.join(clientDist, 'index.html'))
    })
  }

  app.use((req, res) => {
    res.status(404).json({ error: { code: 'not_found', message: 'Unknown route' } })
  })

  app.use(createErrorHandler(logger))
  return app
}
import { createIntelligenceRouter } from './routes/intelligence.js'
