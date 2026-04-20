-- Downstream Hub — password reset tokens + JWT invalidation via token_version (idempotent)

DO $$ BEGIN ALTER TABLE users ADD COLUMN token_version INT NOT NULL DEFAULT 0; EXCEPTION WHEN duplicate_column THEN NULL; END $$;

UPDATE users SET token_version = 0 WHERE token_version IS NULL;

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash VARCHAR(64) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ DEFAULT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  request_ip VARCHAR(45) DEFAULT NULL
);

CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_created
  ON password_reset_tokens(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_hash
  ON password_reset_tokens(token_hash) WHERE used_at IS NULL;
