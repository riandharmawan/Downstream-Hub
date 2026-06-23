-- Downstream Hub — Case 5 V1 unusual login context protection (idempotent)

DO $$ BEGIN
  ALTER TABLE password_policy ADD COLUMN login_risk_enabled BOOLEAN NOT NULL DEFAULT false;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE password_policy ADD COLUMN login_risk_mode VARCHAR(16) NOT NULL DEFAULT 'off';
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE password_policy ADD COLUMN login_risk_known_ip_window_days INT NOT NULL DEFAULT 90;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE password_policy ADD COLUMN login_risk_challenge_ttl_minutes INT NOT NULL DEFAULT 15;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE password_policy ADD COLUMN login_risk_max_distinct_ips_24h INT NOT NULL DEFAULT 0;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

UPDATE password_policy SET
  login_risk_enabled = COALESCE(login_risk_enabled, false),
  login_risk_mode = COALESCE(login_risk_mode, 'off'),
  login_risk_known_ip_window_days = COALESCE(login_risk_known_ip_window_days, 90),
  login_risk_challenge_ttl_minutes = COALESCE(login_risk_challenge_ttl_minutes, 15),
  login_risk_max_distinct_ips_24h = COALESCE(login_risk_max_distinct_ips_24h, 0)
WHERE id = 1;

CREATE TABLE IF NOT EXISTS user_login_contexts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ip_address VARCHAR(45) NOT NULL,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  seen_count INT NOT NULL DEFAULT 1,
  last_user_agent VARCHAR(512) DEFAULT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_login_contexts_user_ip
  ON user_login_contexts(user_id, ip_address);

CREATE INDEX IF NOT EXISTS idx_user_login_contexts_user_last_seen
  ON user_login_contexts(user_id, last_seen_at DESC);

CREATE TABLE IF NOT EXISTS login_risk_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash VARCHAR(64) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ DEFAULT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  request_ip VARCHAR(45) DEFAULT NULL
);

CREATE INDEX IF NOT EXISTS idx_login_risk_challenges_user_created
  ON login_risk_challenges(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_login_risk_challenges_hash
  ON login_risk_challenges(token_hash) WHERE used_at IS NULL;
