-- 0001 — identity, tenancy, organisations, twins, evidence, audit
-- Every tenant-private table: tenant_id NOT NULL + FORCE ROW LEVEL SECURITY.
-- Sessions are global (token lookup precedes tenant resolution), so no RLS
-- there; membership is the join table that RLS policies trust via
-- EXISTS (SELECT 1 FROM tenant_members m WHERE m.tenant_id = current_setting('app.tenant_id')::uuid
--                                          AND m.user_id = current_setting('app.user_id')::uuid
--                                          AND m.active).

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()
DO $$ BEGIN CREATE EXTENSION IF NOT EXISTS citext; EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- ---------------------------------------------------------------- identity
CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         citext NOT NULL UNIQUE,
  password_hash text NOT NULL,
  email_verified_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tenants (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tenant_members (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id   uuid NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
  roles     text[] NOT NULL DEFAULT '{viewer}'
    CHECK (roles <@ ARRAY['admin','analyst','commercial','reviewer','viewer']),
  active    boolean NOT NULL DEFAULT true,
  PRIMARY KEY (tenant_id, user_id)
);

CREATE TABLE sessions (
  token_hash text PRIMARY KEY,          -- sha256 of bearer token; raw never stored
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_idx ON sessions(user_id);

-- ---------------------------------------------------------- organisations
CREATE TABLE organisations (
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_name text NOT NULL,
  entity_type    text NOT NULL DEFAULT 'other'
                 CHECK (entity_type IN ('provider','buyer','partner','other')),
  domains        text[] NOT NULL DEFAULT '{}',
  aliases        text[] NOT NULL DEFAULT '{}',
  parent_id      uuid REFERENCES organisations(id) ON DELETE SET NULL,
  country        text,
  notes          text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, canonical_name)
);
CREATE INDEX organisations_tenant_idx ON organisations(tenant_id);

-- ------------------------------------------------------------------ twins
CREATE TABLE twins (
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  offering        boolean NOT NULL DEFAULT false,
  owner_user_id   uuid NOT NULL REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX twins_tenant_idx ON twins(tenant_id, organisation_id);

CREATE TABLE twin_versions (
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  twin_id     uuid NOT NULL REFERENCES twins(id) ON DELETE CASCADE,
  version     integer NOT NULL,
  status      text NOT NULL DEFAULT 'draft'
              CHECK (status IN ('draft','active','superseded')),
  mandate     text,
  permitted_markets text[] NOT NULL DEFAULT '{}',
  excluded_markets  text[] NOT NULL DEFAULT '{}',
  objectives  text[] NOT NULL DEFAULT '{}',
  capabilities jsonb NOT NULL DEFAULT '[]',
  constraints jsonb NOT NULL DEFAULT '{}',
  source_ids  uuid[] NOT NULL DEFAULT '{}',
  created_by  uuid NOT NULL REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (twin_id, version)
);
CREATE INDEX twin_versions_twin_idx ON twin_versions(twin_id, version DESC);

-- --------------------------------------------------------------- evidence
CREATE TABLE sources (
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind         text NOT NULL CHECK (kind IN ('url','document','user_input')),
  url          text,
  publisher    text,
  source_type  text NOT NULL DEFAULT 'other'
               CHECK (source_type IN ('registry','press','filing','company_page','directory','user_declaration','other')),
  published_at timestamptz,          -- unknown stays NULL
  observed_at  timestamptz NOT NULL DEFAULT now(),
  retrieved_at timestamptz,
  content_hash text,
  excerpt      text,
  language     text,
  notes        text,
  created_by   uuid NOT NULL REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sources_tenant_idx ON sources(tenant_id);

CREATE TABLE claims (
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_type   text NOT NULL CHECK (subject_type IN ('organisation','person','opportunity','twin')),
  subject_id     uuid NOT NULL,
  predicate      text NOT NULL,
  value          jsonb NOT NULL,
  unit           text,
  effective_start date,
  effective_end   date,
  assertion_type text NOT NULL
                 CHECK (assertion_type IN ('sourced_fact','user_claim','inference','unknown','disputed')),
  evidence_source_ids uuid[] NOT NULL DEFAULT '{}',
  rationale      text,
  created_by     uuid NOT NULL REFERENCES users(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inference_law CHECK (
    assertion_type <> 'inference' OR (rationale IS NOT NULL AND rationale <> '')
  )
);
CREATE INDEX claims_subject_idx ON claims(tenant_id, subject_type, subject_id);

CREATE TABLE signals (
  tenant_id          uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type         text NOT NULL,
  occurred_at        timestamptz NOT NULL,
  summary            text NOT NULL,
  source_ids         uuid[] NOT NULL DEFAULT '{}',
  claim_refs         uuid[] NOT NULL DEFAULT '{}',
  affected_org_ids   uuid[] NOT NULL DEFAULT '{}',
  related_signal_ids uuid[] NOT NULL DEFAULT '{}',
  created_by         uuid NOT NULL REFERENCES users(id),
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX signals_tenant_idx ON signals(tenant_id, occurred_at DESC);

-- ------------------------------------------------------------------ audit
CREATE TABLE audit_events (
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id  uuid REFERENCES users(id),
  action         text NOT NULL,
  object_type    text NOT NULL,
  object_id      uuid,
  object_version integer,
  payload_hash   text,
  correlation_id text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_tenant_idx ON audit_events(tenant_id, created_at DESC);

-- ------------------------------------------------------- RLS: the hard law
-- Helper predicate (inline in each policy): the acting user must be an ACTIVE
-- member of the row's tenant. GUCs are transaction-local (SET LOCAL).

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'organisations','twins','twin_versions','sources','claims','signals','audit_events'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', t);
    EXECUTE format($p$
      CREATE POLICY tenant_isolation ON %I
        USING (
          tenant_id = current_setting('app.tenant_id', true)::uuid
          AND EXISTS (
            SELECT 1 FROM tenant_members m
            WHERE m.tenant_id = current_setting('app.tenant_id', true)::uuid
              AND m.user_id   = current_setting('app.user_id', true)::uuid
              AND m.active
          )
        )
        WITH CHECK (
          tenant_id = current_setting('app.tenant_id', true)::uuid
        );
    $p$, t);
  END LOOP;
END $$;
