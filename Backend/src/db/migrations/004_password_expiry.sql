-- Downstream Hub — password expiry: password_changed_at on users, password_policy table (idempotent)

-- 1. Users: add password_changed_at (when password was last set; used for expiry check)
DO $$
BEGIN
  ALTER TABLE users ADD COLUMN password_changed_at TIMESTAMPTZ DEFAULT NULL;
EXCEPTION
  WHEN duplicate_column THEN NULL;
END $$;

-- 2. Backfill existing users: set to now() so they get a full expiry period from go-live
UPDATE users SET password_changed_at = now() WHERE password_changed_at IS NULL AND deleted_at IS NULL;

-- 3. Password policy (single row: 0 = disabled, >0 = expire after N days)
CREATE TABLE IF NOT EXISTS password_policy (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  password_expiry_days INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO password_policy (id, password_expiry_days)
VALUES (1, 0)
ON CONFLICT (id) DO NOTHING;
