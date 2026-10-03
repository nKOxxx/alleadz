-- 0007 — vertical lanes + mandate presets (blueprint-audit fix 4).
-- A tenant runs ONE active lane at a time (the A/B test = one tenant per lane;
-- funnels are compared across lanes in the weekly cohort report). Presets are
-- curated configs: twin seed, source list, pain-cue lexicon, export template,
-- qualification gate. v1 keeps them versionless in-repo; per-tenant overrides
-- land in vertical_presets when first customized.
BEGIN;

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS lane text;

CREATE TABLE IF NOT EXISTS vertical_presets (
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key        text NOT NULL CHECK (key IN ('bank-frick','own-products')),
  config     jsonb NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, key)
);

ALTER TABLE vertical_presets ENABLE ROW LEVEL SECURITY;
ALTER TABLE vertical_presets FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON vertical_presets
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid
         AND EXISTS (SELECT 1 FROM tenant_members m
                     WHERE m.tenant_id = current_setting('app.tenant_id', true)::uuid
                       AND m.user_id = current_setting('app.user_id', true)::uuid
                       AND m.active));

-- new measured action for the retention funnel (same law as 0006: one row per
-- measured decision; lane selection is the vertical-commitment event)
ALTER TABLE events DROP CONSTRAINT events_event_type_check;
ALTER TABLE events ADD CONSTRAINT events_event_type_check CHECK (event_type IN
  ('auth.registered','discovery.run','discovery.analyze','signal.promoted',
   'bundle.exported','vertical.applied'));

COMMIT;
