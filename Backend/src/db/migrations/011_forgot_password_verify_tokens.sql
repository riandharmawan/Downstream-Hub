-- Downstream Hub — Forgot-password verification tokens (idempotent)

CREATE TABLE IF NOT EXISTS forgot_password_verify_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash VARCHAR(64) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ DEFAULT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  request_ip VARCHAR(45) DEFAULT NULL
);

CREATE INDEX IF NOT EXISTS idx_forgot_pwd_verify_tokens_user_created
  ON forgot_password_verify_tokens(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_forgot_pwd_verify_tokens_hash
  ON forgot_password_verify_tokens(token_hash) WHERE used_at IS NULL;
