-- 0008 — rung #3 contact finder: hypothesis email class + mint provenance.
-- ADDITIVE ONLY. email_class is TEXT + inline CHECK (0004), not a PG enum:
-- swap the check to admit 'hypothesis'. Existing rows untouched.
-- Law: a pattern-minted address is a GUESS; it is stored AS a guess
-- (email_class='hypothesis') with its generation inputs kept in mint_meta so
-- a human can accept or kill it. Hypotheses are never auto-sent (P4).
BEGIN;

ALTER TABLE contact_points DROP CONSTRAINT IF EXISTS contact_points_email_class_check;
ALTER TABLE contact_points ADD CONSTRAINT contact_points_email_class_check
  CHECK (email_class IN ('person_published', 'company_published', 'third_party_reported',
    'functional_inbox', 'non_commercial_inbox', 'not_found', 'hypothesis'));

CREATE TABLE IF NOT EXISTS contact_hypotheses (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_point_id uuid NOT NULL REFERENCES contact_points(id) ON DELETE CASCADE,
  pattern text NOT NULL,                -- e.g. 'first.last'
  address text NOT NULL,                -- the minted address itself
  mint_meta jsonb NOT NULL DEFAULT '{}'::jsonb,  -- {first,last,domain,basis}
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, address)
);

CREATE INDEX IF NOT EXISTS contact_hypotheses_tenant_idx ON contact_hypotheses(tenant_id, contact_point_id);

DO $$
BEGIN
  EXECUTE format('ALTER TABLE contact_hypotheses ENABLE ROW LEVEL SECURITY');
  EXECUTE format('ALTER TABLE contact_hypotheses FORCE ROW LEVEL SECURITY');
  EXECUTE format($f$CREATE POLICY tenant_isolation ON contact_hypotheses
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid
           AND EXISTS (SELECT 1 FROM tenant_members m
                       WHERE m.tenant_id = current_setting('app.tenant_id', true)::uuid
                         AND m.user_id = current_setting('app.user_id', true)::uuid
                         AND m.active))$f$);
END $$;

COMMIT;
