-- 0002 — imports, import rows, merges, research tasks (P2)
BEGIN;

-- One uploaded file: preview -> commit/reject lifecycle.
CREATE TABLE IF NOT EXISTS imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  filename text NOT NULL,
  uploaded_by uuid NOT NULL REFERENCES users(id),
  status text NOT NULL DEFAULT 'pending_review'
    CHECK (status IN ('pending_review','committed','rejected')),
  column_map jsonb NOT NULL DEFAULT '{}'::jsonb,
  row_count int NOT NULL DEFAULT 0,
  reject_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  committed_at timestamptz
);

-- Raw parsed rows retained forever (law: originals never destroyed).
CREATE TABLE IF NOT EXISTS import_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id uuid NOT NULL REFERENCES imports(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  row_number int NOT NULL,
  raw jsonb NOT NULL,
  parse_status text NOT NULL CHECK (parse_status IN ('ok','error')),
  parse_error text,
  created_org_id uuid REFERENCES organisations(id),
  duplicate_of_org_id uuid REFERENCES organisations(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_import_rows_import ON import_rows(import_id);

-- Reviewer-performed merges; original rows retained (never hard-deleted).
CREATE TABLE IF NOT EXISTS merges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  survivor_org_id uuid NOT NULL REFERENCES organisations(id),
  merged_org_id uuid NOT NULL REFERENCES organisations(id),
  performed_by uuid NOT NULL REFERENCES users(id),
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE merges ENABLE ROW LEVEL SECURITY;
ALTER TABLE merges FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON merges
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid
         AND EXISTS (SELECT 1 FROM tenant_members m
                     WHERE m.tenant_id = current_setting('app.tenant_id', true)::uuid
                       AND m.user_id = current_setting('app.user_id', true)::uuid
                       AND m.active));
ALTER TABLE imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE imports FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON imports
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid
         AND EXISTS (SELECT 1 FROM tenant_members m
                     WHERE m.tenant_id = current_setting('app.tenant_id', true)::uuid
                       AND m.user_id = current_setting('app.user_id', true)::uuid
                       AND m.active));
ALTER TABLE import_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_rows FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON import_rows
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid
         AND EXISTS (SELECT 1 FROM tenant_members m
                     WHERE m.tenant_id = current_setting('app.tenant_id', true)::uuid
                       AND m.user_id = current_setting('app.user_id', true)::uuid
                       AND m.active));

-- P2 adds merged_into_id to organisations (contract ADD, not redefine).
ALTER TABLE organisations ADD COLUMN IF NOT EXISTS merged_into_id uuid REFERENCES organisations(id);

-- Research queue: entities that need human research, with reason.
CREATE TABLE IF NOT EXISTS research_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  organisation_id uuid REFERENCES organisations(id),
  import_row_id uuid REFERENCES import_rows(id),
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','done','dismissed')),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
ALTER TABLE research_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE research_tasks FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON research_tasks
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid
         AND EXISTS (SELECT 1 FROM tenant_members m
                     WHERE m.tenant_id = current_setting('app.tenant_id', true)::uuid
                       AND m.user_id = current_setting('app.user_id', true)::uuid
                       AND m.active));

COMMIT;
