-- Downstream Hub — OIDC metadata, auth codes, cookie sessions, MFA/risk tables (idempotent)

-- Applications: OIDC registration metadata
DO $$ BEGIN
  ALTER TABLE applications ADD COLUMN oauth_client_id VARCHAR(128);
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE applications ADD COLUMN oidc_redirect_uris TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE applications ADD COLUMN sso_mode VARCHAR(16) NOT NULL DEFAULT 'bridge';
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_applications_oauth_client_id_unique
  ON applications(oauth_client_id)
  WHERE oauth_client_id IS NOT NULL AND deleted_at IS NULL;

-- Password policy: add MFA controls
DO $$ BEGIN
  ALTER TABLE password_policy ADD COLUMN mfa_reverify_days INT NOT NULL DEFAULT 14;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE password_policy ADD COLUMN mfa_risk_threshold INT NOT NULL DEFAULT 50;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- Users: display name and MFA profile
DO $$ BEGIN
  ALTER TABLE users ADD COLUMN name VARCHAR(255);
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE users ADD COLUMN mfa_enabled BOOLEAN NOT NULL DEFAULT false;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE users ADD COLUMN mfa_method VARCHAR(32) NOT NULL DEFAULT 'email_otp';
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE users ADD COLUMN last_mfa_verified_at TIMESTAMPTZ;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- Cookie-backed sessions for Hub SPA
CREATE TABLE IF NOT EXISTS auth_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_token_hash VARCHAR(128) NOT NULL UNIQUE,
  csrf_token_hash VARCHAR(128) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_active ON auth_sessions(expires_at) WHERE revoked_at IS NULL;

-- OIDC auth-code + PKCE
CREATE TABLE IF NOT EXISTS oidc_authorization_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code_hash VARCHAR(128) NOT NULL UNIQUE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  application_id UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  client_id VARCHAR(128) NOT NULL,
  redirect_uri TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'openid profile email',
  nonce VARCHAR(255),
  code_challenge VARCHAR(255) NOT NULL,
  code_challenge_method VARCHAR(16) NOT NULL DEFAULT 'S256',
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_oidc_codes_client_active
  ON oidc_authorization_codes(client_id, expires_at)
  WHERE consumed_at IS NULL;

-- MFA challenge + trusted devices + risk logs
CREATE TABLE IF NOT EXISTS mfa_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason VARCHAR(32) NOT NULL,
  challenge_hash VARCHAR(128) NOT NULL UNIQUE,
  otp_hash VARCHAR(255) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  attempts INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 5,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mfa_challenges_user_active
  ON mfa_challenges(user_id, expires_at)
  WHERE consumed_at IS NULL;

CREATE TABLE IF NOT EXISTS trusted_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_hash VARCHAR(128) NOT NULL,
  label VARCHAR(255),
  first_ip VARCHAR(64),
  last_ip VARCHAR(64),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_trusted_devices_active_unique
  ON trusted_devices(user_id, device_hash)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS login_risk_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  email VARCHAR(255),
  ip_address VARCHAR(64),
  user_agent TEXT,
  device_hash VARCHAR(128),
  risk_score INT NOT NULL,
  reasons TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  decision VARCHAR(32) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_login_risk_events_user_created
  ON login_risk_events(user_id, created_at DESC);
