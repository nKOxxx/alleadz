-- 0005 — discovery runs + snapshot storage (P5)
BEGIN;

CREATE TABLE IF NOT EXISTS discovery_runs (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid REFERENCES organisations(id),
  requested_url text NOT NULL,
  final_url text,
  http_status int,
  content_hash text,
  bytes int,
  extracted jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'ok' CHECK (status IN ('ok','failed','blocked')),
  error text,
  run_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX discovery_runs_org_idx ON discovery_runs(tenant_id, organisation_id);

CREATE TABLE IF NOT EXISTS discovery_snapshots (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES discovery_runs(id) ON DELETE CASCADE,
  content_hash text NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE discovery_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE discovery_runs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON discovery_runs
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid
         AND EXISTS (SELECT 1 FROM tenant_members m
                     WHERE m.tenant_id = current_setting('app.tenant_id', true)::uuid
                       AND m.user_id = current_setting('app.user_id', true)::uuid
                       AND m.active));
ALTER TABLE discovery_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE discovery_snapshots FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON discovery_snapshots
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid
         AND EXISTS (SELECT 1 FROM tenant_members m
                     WHERE m.tenant_id = current_setting('app.tenant_id', true)::uuid
                       AND m.user_id = current_setting('app.user_id', true)::uuid
                       AND m.active));

COMMIT;
