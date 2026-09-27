// server/test/ratelimit.test.js
// Unit test for the fixed-window limiter — no DB needed, runs in CI too.

import { describe, expect, it } from 'vitest'
import { createRateLimiter } from '../src/middleware/rate-limit.js'

function mockRes() {
  const res = {
    headers: {},
    setHeader: (k, v) => { res.headers[k] = v },
    status(code) { res.statusCode = code; return res },
    json(body) { res.body = body; return res },
  }
  return res
}

describe('rate limiter (fixed window)', () => {
  it('allows up to max, then 429 with Retry-After, per key', () => {
    const limiter = createRateLimiter({ windowMs: 1000, max: 3 })
    const req = (ip) => ({ ip })
    const nexts = []

    for (let i = 0; i < 3; i++) {
      let called = false
      limiter(req('1.2.3.4'), mockRes(), () => { called = true })
      nexts.push(called)
    }
    expect(nexts).toEqual([true, true, true])

    const res = mockRes()
    let calledAgain = false
    limiter(req('1.2.3.4'), res, () => { calledAgain = true })
    expect(calledAgain).toBe(false)
    expect(res.statusCode).toBe(429)
    expect(res.body.error.code).toBe('rate_limited')
    expect(Number(res.headers['Retry-After'])).toBeGreaterThan(0)

    // different key unaffected
    let otherCalled = false
    limiter(req('5.6.7.8'), mockRes(), () => { otherCalled = true })
    expect(otherCalled).toBe(true)
  })
})
