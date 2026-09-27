// server/src/middleware/security-headers.js
// Baseline hardening headers on every response. CSP is API-appropriate
// (default-src 'none'); the client app ships its own HTML with its own CSP.

export function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'")
  res.setHeader('Cache-Control', 'no-store')
  next()
}
