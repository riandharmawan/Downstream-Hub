-- Downstream Hub — account activation via one-time email link (idempotent)

DO $$
BEGIN
  ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ DEFAULT NULL;
END $$;

CREATE TABLE IF NOT EXISTS account_activation_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash VARCHAR(64) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ DEFAULT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  request_ip VARCHAR(45) DEFAULT NULL
);

CREATE INDEX IF NOT EXISTS idx_account_activation_tokens_user_created
  ON account_activation_tokens(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_account_activation_tokens_hash
  ON account_activation_tokens(token_hash) WHERE used_at IS NULL;
