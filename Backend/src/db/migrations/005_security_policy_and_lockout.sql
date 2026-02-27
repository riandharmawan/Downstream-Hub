-- Downstream Hub — security policy (complexity, history, lockout) and user lockout columns (idempotent)

-- 1. Extend password_policy with new columns (defaults preserve existing behaviour; one block per column for idempotence)
DO $$ BEGIN ALTER TABLE password_policy ADD COLUMN min_password_length INT NOT NULL DEFAULT 6; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE password_policy ADD COLUMN require_uppercase BOOLEAN NOT NULL DEFAULT true; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE password_policy ADD COLUMN require_lowercase BOOLEAN NOT NULL DEFAULT true; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE password_policy ADD COLUMN require_number BOOLEAN NOT NULL DEFAULT true; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE password_policy ADD COLUMN require_symbol BOOLEAN NOT NULL DEFAULT true; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE password_policy ADD COLUMN password_history_count INT NOT NULL DEFAULT 5; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE password_policy ADD COLUMN max_login_attempts INT NOT NULL DEFAULT 5; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE password_policy ADD COLUMN lockout_duration_mins INT NOT NULL DEFAULT 30; EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- 2. Backfill existing row (in case table existed with only id, password_expiry_days, updated_at)
UPDATE password_policy SET
  min_password_length = COALESCE(min_password_length, 6),
  require_uppercase = COALESCE(require_uppercase, true),
  require_lowercase = COALESCE(require_lowercase, true),
  require_number = COALESCE(require_number, true),
  require_symbol = COALESCE(require_symbol, true),
  password_history_count = COALESCE(password_history_count, 5),
  max_login_attempts = COALESCE(max_login_attempts, 5),
  lockout_duration_mins = COALESCE(lockout_duration_mins, 30)
WHERE id = 1;

-- 3. Users: lockout columns
DO $$ BEGIN ALTER TABLE users ADD COLUMN failed_login_attempts INT NOT NULL DEFAULT 0; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE users ADD COLUMN locked_until TIMESTAMPTZ DEFAULT NULL; EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- 4. Password history table
CREATE TABLE IF NOT EXISTS user_password_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  password_hash VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_password_history_user_created
  ON user_password_history(user_id, created_at DESC);
