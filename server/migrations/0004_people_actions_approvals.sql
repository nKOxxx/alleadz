-- 0004 — people, employments, contact points, action plans, approvals (P4)
BEGIN;

CREATE TABLE IF NOT EXISTS people (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text NOT NULL,
  organisation_id uuid REFERENCES organisations(id),
  role_title text,
  seniority text CHECK (seniority IN ('unknown','individual','manager','director','vp','c_level','board') OR seniority IS NULL),
  is_public_person boolean NOT NULL DEFAULT false,
  merged_into_id uuid REFERENCES people(id),
  notes text,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS contact_points (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('email','phone','linkedin','other')),
  value text NOT NULL,
  email_class text CHECK (email_class IN ('person_published','company_published','third_party_reported','functional_inbox','non_commercial_inbox','not_found')),
  deliverability text NOT NULL DEFAULT 'untested' CHECK (deliverability IN ('untested','verified','failed')),
  source_ids uuid[] NOT NULL DEFAULT '{}',
  notes text,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
-- published ≠ deliverable: a published address must never be auto-emailed
-- without an approved plan; deliverability is a separate, explicit field.

CREATE TABLE IF NOT EXISTS relationships (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_person_id uuid NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  to_person_id uuid NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  relationship_type text NOT NULL,
  evidence_refs uuid[] NOT NULL DEFAULT '{}',
  confirmed_by uuid REFERENCES users(id),
  notes text,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS action_plans (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id uuid NOT NULL REFERENCES opportunities(id),
  title text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','executing','done','cancelled')),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS action_tasks (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES action_plans(id) ON DELETE CASCADE,
  sequence int NOT NULL DEFAULT 1,
  kind text NOT NULL CHECK (kind IN ('email','call','linkedin','event','wait','internal')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  contact_point_id uuid REFERENCES contact_points(id),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','sent','done','skipped','failed')),
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS approvals (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES action_tasks(id),
  recipient_snapshot jsonb NOT NULL,
  content_snapshot jsonb NOT NULL,
  attachment_hashes text[] NOT NULL DEFAULT '{}',
  scope jsonb NOT NULL DEFAULT '{}'::jsonb,
  approved_by uuid NOT NULL REFERENCES users(id),
  approved_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  revoked_reason text
);

CREATE TABLE IF NOT EXISTS outcomes (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id uuid NOT NULL REFERENCES opportunities(id),
  kind text NOT NULL CHECK (kind IN ('meeting','no_reply','declined','deal','lost','other')),
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX people_tenant_idx ON people(tenant_id, organisation_id);
CREATE INDEX contact_points_person_idx ON contact_points(tenant_id, person_id);
CREATE INDEX action_plans_opp_idx ON action_plans(tenant_id, opportunity_id);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['people','contact_points','relationships','action_plans','action_tasks','approvals','outcomes'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($f$CREATE POLICY tenant_isolation ON %I
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid
             AND EXISTS (SELECT 1 FROM tenant_members m
                         WHERE m.tenant_id = current_setting('app.tenant_id', true)::uuid
                           AND m.user_id = current_setting('app.user_id', true)::uuid
                           AND m.active))$f$, t);
  END LOOP;
END $$;

COMMIT;
