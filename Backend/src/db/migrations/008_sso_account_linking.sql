-- Downstream Hub — SSO account linking, verification, and bulk jobs

DO $$ BEGIN
  ALTER TABLE users ADD COLUMN oidc_sub VARCHAR(255);
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE users ADD COLUMN oidc_linked_at TIMESTAMPTZ;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE users ADD COLUMN oidc_linked_by_mode VARCHAR(32);
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE users ADD COLUMN auth_source VARCHAR(16) NOT NULL DEFAULT 'local';
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_oidc_sub_unique
  ON users(oidc_sub)
  WHERE oidc_sub IS NOT NULL AND deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS sso_link_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
  mode VARCHAR(32) NOT NULL,
  event_type VARCHAR(32) NOT NULL,
  status VARCHAR(32) NOT NULL,
  reason_code VARCHAR(64),
  subject_fingerprint VARCHAR(24),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sso_link_events_user_created
  ON sso_link_events(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sso_link_events_actor_created
  ON sso_link_events(actor_id, created_at DESC);

CREATE TABLE IF NOT EXISTS sso_link_email_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
  mode VARCHAR(32) NOT NULL,
  oidc_sub VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL,
  token_hash VARCHAR(128) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sso_link_email_verifications_user_active
  ON sso_link_email_verifications(user_id, expires_at)
  WHERE consumed_at IS NULL;

CREATE TABLE IF NOT EXISTS sso_link_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  source_type VARCHAR(16) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'draft',
  total_rows INT NOT NULL DEFAULT 0,
  ready_rows INT NOT NULL DEFAULT 0,
  linked_rows INT NOT NULL DEFAULT 0,
  blocked_rows INT NOT NULL DEFAULT 0,
  failed_rows INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_sso_link_jobs_created_by
  ON sso_link_jobs(created_by, created_at DESC);

CREATE TABLE IF NOT EXISTS sso_link_job_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES sso_link_jobs(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  email VARCHAR(255),
  oidc_sub VARCHAR(255),
  match_status VARCHAR(32) NOT NULL,
  final_status VARCHAR(32),
  reason_code VARCHAR(64),
  reason_detail TEXT,
  attempt_count INT NOT NULL DEFAULT 0,
  last_attempt_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sso_link_job_items_job
  ON sso_link_job_items(job_id, created_at ASC);
