-- Downstream Hub — Hub session periodic revalidation (idempotent)

DO $$ BEGIN
  ALTER TABLE password_policy ADD COLUMN hub_session_revalidation_days INT NOT NULL DEFAULT 0;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

UPDATE password_policy SET hub_session_revalidation_days = COALESCE(hub_session_revalidation_days, 0) WHERE id = 1;

DO $$ BEGIN
  ALTER TABLE users ADD COLUMN last_hub_session_revalidated_at TIMESTAMPTZ DEFAULT NULL;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS hub_session_revalidation_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash VARCHAR(64) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ DEFAULT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  request_ip VARCHAR(45) DEFAULT NULL
);

CREATE INDEX IF NOT EXISTS idx_hub_session_reval_tokens_user_created
  ON hub_session_revalidation_tokens(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_hub_session_reval_tokens_hash
  ON hub_session_revalidation_tokens(token_hash) WHERE used_at IS NULL;
