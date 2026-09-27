// server/src/lib/errors.js
// Generic errors at the edge; correlation ids; stack traces never leave.

import { randomUUID } from 'node:crypto'
import { ZodError } from 'zod'

export function createErrorHandler(logger = console) {
  // eslint-disable-next-line no-unused-vars
  return function errorHandler(err, req, res, next) {
    const correlationId = randomUUID()

    if (err instanceof ZodError) {
      // client sent invalid input — their problem, not ours: 400, generic message
      res.status(400).json({
        error: { code: 'validation_error', message: 'Invalid request', correlation_id: correlationId },
      })
      return
    }

    logger.error(
      JSON.stringify({
        correlationId,
        method: req.method,
        path: req.path,
        message: err?.message,
        stack: err?.stack,
      }),
    )
    const status = err?.status && Number.isInteger(err.status) ? err.status : 500
    const code = err?.code && typeof err.code === 'string' && status !== 500 ? err.code : 'internal_error'
    res.status(status).json({
      error: {
        code,
        message: status === 500 ? 'Internal error' : err.message,
        correlation_id: correlationId,
      },
    })
  }
}

/** Typed error with an HTTP status (used by routes for 4xx). */
export function httpError(status, code, message) {
  const err = new Error(message)
  err.status = status
  err.code = code
  return err
}
