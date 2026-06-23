-- Downstream Hub — one-time magic link login tokens (idempotent)

CREATE TABLE IF NOT EXISTS magic_link_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash VARCHAR(64) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ DEFAULT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  request_ip VARCHAR(45) DEFAULT NULL
);

CREATE INDEX IF NOT EXISTS idx_magic_link_tokens_user_created
  ON magic_link_tokens(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_magic_link_tokens_hash
  ON magic_link_tokens(token_hash) WHERE used_at IS NULL;
