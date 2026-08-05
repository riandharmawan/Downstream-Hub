-- Login MFA magic link: device last_verified_at + admin-configurable bypass window

DO $$ BEGIN
  ALTER TABLE trusted_devices ADD COLUMN last_verified_at TIMESTAMPTZ;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE password_policy ADD COLUMN login_mfa_bypass_mode VARCHAR(16) NOT NULL DEFAULT 'rolling_24h';
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE password_policy ADD COLUMN login_mfa_bypass_hours INT NOT NULL DEFAULT 24;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE password_policy ADD COLUMN login_mfa_bypass_timezone VARCHAR(64) NOT NULL DEFAULT 'UTC';
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- Backfill last_verified_at from last_seen_at for existing trusted devices
UPDATE trusted_devices
SET last_verified_at = last_seen_at
WHERE last_verified_at IS NULL AND last_seen_at IS NOT NULL;

DO $$ BEGIN
  ALTER TABLE magic_link_tokens ADD COLUMN pending_login_hash VARCHAR(128) DEFAULT NULL;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_magic_link_tokens_pending_login
  ON magic_link_tokens(pending_login_hash) WHERE used_at IS NULL;
