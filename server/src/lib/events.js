// server/src/lib/events.js — usage event emission (retention instrumentation).
// Law: emission is BEST-EFFORT and SYNCHRONOUS-FREE. trackEvent never throws
// and never blocks the action it observes: a broken analytics path must not
// break the product. Failures are logged once and swallowed.
//
// Event types are a closed set (CHECK constraint in 0006/0007):
//   auth.registered | discovery.run | discovery.analyze | signal.promoted | bundle.exported
//   vertical.applied (lane commitment — 0007_verticals.sql)
// Value action: bundle.exported (retention "Aha"); leading indicator: signal.promoted.

const KNOWN = new Set([
  'auth.registered',
  'discovery.run',
  'discovery.analyze',
  'signal.promoted',
  'bundle.exported',
  'vertical.applied',
])

/**
 * Fire-and-forget event insert inside an existing withTenant transaction.
 * Signature mirrors the audit() helper in routes/intelligence.js on purpose:
 * same transaction, same RLS context, same house style.
 * @param {import('pg').PoolClient} client - active tenant-scoped client
 * @param {string} tenantId
 * @param {string} eventType - one of KNOWN
 * @param {{actorUserId?: string|null, objectId?: string|null, metadata?: object}} [rest]
 */
export async function trackEvent(client, tenantId, eventType, rest = {}) {
  if (!KNOWN.has(eventType)) {
    console.warn(`trackEvent: unknown event type "${eventType}" — dropped`)
    return
  }
  try {
    await client.query(
      `INSERT INTO events (tenant_id, event_type, actor_user_id, object_id, metadata)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [tenantId, eventType, rest.actorUserId ?? null, rest.objectId ?? null,
       JSON.stringify(rest.metadata ?? {})],
    )
  } catch (err) {
    // Best-effort law: log at warning level, never propagate.
    console.warn(`trackEvent(${eventType}) failed (non-fatal): ${err.message}`)
  }
}

/** Fire-and-forget OUTSIDE any transaction (auth flows). Uses its own client. */
export async function trackEventStandalone(pool, tenantId, eventType, rest = {}) {
  if (!KNOWN.has(eventType)) {
    console.warn(`trackEvent: unknown event type "${eventType}" — dropped`)
    return
  }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId])
    if (rest.actorUserId) {
      await client.query(`SELECT set_config('app.user_id', $1, true)`, [rest.actorUserId])
    }
    await client.query(
      `INSERT INTO events (tenant_id, event_type, actor_user_id, object_id, metadata)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [tenantId, eventType, rest.actorUserId ?? null, rest.objectId ?? null,
       JSON.stringify(rest.metadata ?? {})],
    )
    await client.query('COMMIT')
  } catch (err) {
    try { await client.query('ROLLBACK') } catch { /* already closed */ }
    console.warn(`trackEventStandalone(${eventType}) failed (non-fatal): ${err.message}`)
  } finally {
    client.release()
  }
}
