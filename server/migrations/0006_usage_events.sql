-- 0006 — usage events (retention instrumentation; Lieb law: track cohorts, never aggregates)
-- One row per measured action. tenant-scoped, RLS-FORCEd like every tenant table.
-- Emission is best-effort: a failing event insert must never fail the action itself.
BEGIN;

CREATE TABLE IF NOT EXISTS events (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL CHECK (event_type IN
    ('auth.registered','discovery.run','discovery.analyze','signal.promoted','bundle.exported')),
  actor_user_id uuid REFERENCES users(id),
  object_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX events_tenant_type_idx ON events(tenant_id, event_type, created_at);

ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE events FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON events
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid
         AND EXISTS (SELECT 1 FROM tenant_members m
                     WHERE m.tenant_id = current_setting('app.tenant_id', true)::uuid
                       AND m.user_id = current_setting('app.user_id', true)::uuid
                       AND m.active));

COMMIT;
