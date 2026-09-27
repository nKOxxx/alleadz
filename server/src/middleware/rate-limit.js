// server/src/middleware/rate-limit.js
// Fixed-window in-memory limiter (per-IP). Multi-instance deployments swap
// this for a shared store; single-instance alpha is the documented scope.
// Returns 429 with Retry-After; never differentiates register/login messages.

export function createRateLimiter({ windowMs = 60_000, max = 30 } = {}) {
  const hits = new Map() // ip -> {count, resetAt}
  return function rateLimit(req, res, next) {
    const key = req.ip || 'unknown'
    const now = Date.now()
    let bucket = hits.get(key)
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs }
      hits.set(key, bucket)
      if (hits.size > 10_000) {
        // opportunistic cleanup to bound memory
        for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k)
      }
    }
    bucket.count += 1
    if (bucket.count > max) {
      res.setHeader('Retry-After', Math.ceil((bucket.resetAt - now) / 1000))
      res.status(429).json({ error: { code: 'rate_limited', message: 'Too many requests' } })
      return
    }
    next()
  }
}

/** Strict limiter for auth endpoints (register/login/verify). */
export function createAuthRateLimiter() {
  return createRateLimiter({ windowMs: 60_000, max: 10 })
}
