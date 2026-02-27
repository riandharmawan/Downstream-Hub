-- Downstream Hub — soft delete: deleted_at column + partial unique indexes (idempotent)

-- 1. Add deleted_at to all tables
DO $$
BEGIN
  ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;
  ALTER TABLE applications ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;
  ALTER TABLE allowed_domains ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;
  ALTER TABLE business_units ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;
  ALTER TABLE sso_access_logs ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;
END $$;

-- 2. Users: replace email UNIQUE with partial unique (allow same email after soft delete)
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_email_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_active ON users(email) WHERE deleted_at IS NULL;

-- 3. Allowed domains: replace domain UNIQUE with partial unique
ALTER TABLE allowed_domains DROP CONSTRAINT IF EXISTS allowed_domains_domain_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_allowed_domains_domain_active ON allowed_domains(domain) WHERE deleted_at IS NULL;

-- 4. Business units: replace name UNIQUE with partial unique
ALTER TABLE business_units DROP CONSTRAINT IF EXISTS business_units_name_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_business_units_name_active ON business_units(name) WHERE deleted_at IS NULL;

-- 5. Indexes for filtering by deleted_at (optional, helps list queries)
CREATE INDEX IF NOT EXISTS idx_applications_deleted_at ON applications(deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_users_deleted_at ON users(deleted_at) WHERE deleted_at IS NULL;
