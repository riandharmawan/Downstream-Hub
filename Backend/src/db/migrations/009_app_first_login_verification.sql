-- Downstream Hub — first-login app verification via one-time magic link (idempotent)

CREATE TABLE IF NOT EXISTS user_application_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  application_id UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  last_verified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  verified_via VARCHAR(32) NOT NULL DEFAULT 'magic_link',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, application_id)
);

CREATE INDEX IF NOT EXISTS idx_user_app_verifications_user_app
  ON user_application_verifications(user_id, application_id);

CREATE TABLE IF NOT EXISTS app_login_magic_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  application_id UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  token_hash VARCHAR(64) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ DEFAULT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  request_ip VARCHAR(45) DEFAULT NULL
);

CREATE INDEX IF NOT EXISTS idx_app_login_magic_tokens_user_app_created
  ON app_login_magic_tokens(user_id, application_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_app_login_magic_tokens_hash
  ON app_login_magic_tokens(token_hash) WHERE used_at IS NULL;
