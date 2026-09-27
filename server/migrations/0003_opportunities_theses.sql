-- 0003 — opportunities, theses, stage transitions, hard checks (P3)
BEGIN;

CREATE TABLE IF NOT EXISTS opportunities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  offering_twin_id uuid NOT NULL REFERENCES twins(id),
  target_org_id uuid NOT NULL REFERENCES organisations(id),
  sector_type text NOT NULL,
  owner uuid NOT NULL REFERENCES users(id),
  stage text NOT NULL DEFAULT 'candidate'
    CHECK (stage IN ('candidate','researching','thesis_ready','human_reviewed',
                     'qualifying','qualified','handed_off','outcome_recorded',
                     'watch','rejected')),
  branch_reason text,
  latest_thesis_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, offering_twin_id, target_org_id, sector_type)
);

CREATE TABLE IF NOT EXISTS theses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  opportunity_id uuid NOT NULL REFERENCES opportunities(id),
  version int NOT NULL,
  twin_version_id uuid REFERENCES twin_versions(id),
  signal_ids uuid[] NOT NULL DEFAULT '{}',
  rule_version text NOT NULL,
  sections jsonb NOT NULL,
  scores jsonb NOT NULL,
  hard_checks jsonb NOT NULL,
  coverage numeric NOT NULL,
  priority numeric NOT NULL,
  confidence text NOT NULL CHECK (confidence IN ('insufficient','low','medium','high')),
  missing_conditions text[] NOT NULL DEFAULT '{}',
  invalidators jsonb NOT NULL DEFAULT '[]'::jsonb,
  contradictions jsonb NOT NULL DEFAULT '[]'::jsonb,
  value_models jsonb NOT NULL DEFAULT '[]'::jsonb,
  needs_reassessment boolean NOT NULL DEFAULT false,
  author_actor uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, opportunity_id, version)
);

CREATE TABLE IF NOT EXISTS opportunity_transitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  opportunity_id uuid NOT NULL REFERENCES opportunities(id),
  from_stage text NOT NULL,
  to_stage text NOT NULL,
  actor uuid NOT NULL REFERENCES users(id),
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rubric_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  thesis_id uuid NOT NULL REFERENCES theses(id),
  dimension text NOT NULL,
  old_rating jsonb,
  new_rating jsonb NOT NULL,
  reason text NOT NULL,
  actor uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE opportunities ENABLE ROW LEVEL SECURITY;
ALTER TABLE opportunities FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON opportunities
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid
         AND EXISTS (SELECT 1 FROM tenant_members m
                     WHERE m.tenant_id = current_setting('app.tenant_id', true)::uuid
                       AND m.user_id = current_setting('app.user_id', true)::uuid
                       AND m.active));
ALTER TABLE theses ENABLE ROW LEVEL SECURITY;
ALTER TABLE theses FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON theses
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid
         AND EXISTS (SELECT 1 FROM tenant_members m
                     WHERE m.tenant_id = current_setting('app.tenant_id', true)::uuid
                       AND m.user_id = current_setting('app.user_id', true)::uuid
                       AND m.active));
ALTER TABLE opportunity_transitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE opportunity_transitions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON opportunity_transitions
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid
         AND EXISTS (SELECT 1 FROM tenant_members m
                     WHERE m.tenant_id = current_setting('app.tenant_id', true)::uuid
                       AND m.user_id = current_setting('app.user_id', true)::uuid
                       AND m.active));
ALTER TABLE rubric_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE rubric_overrides FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON rubric_overrides
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid
         AND EXISTS (SELECT 1 FROM tenant_members m
                     WHERE m.tenant_id = current_setting('app.tenant_id', true)::uuid
                       AND m.user_id = current_setting('app.user_id', true)::uuid
                       AND m.active));

COMMIT;
