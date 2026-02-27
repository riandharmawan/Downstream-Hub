-- Downstream Hub — domain whitelist, business units, app-to-BU, SSO access log (idempotent)

-- 1. Allowed domains (whitelist for registration)
CREATE TABLE IF NOT EXISTS allowed_domains (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  domain VARCHAR(255) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_allowed_domains_domain ON allowed_domains(domain);

-- 2. Business units (departments for user and app mapping)
CREATE TABLE IF NOT EXISTS business_units (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. Users: add business_unit_id (nullable FK)
DO $$
BEGIN
  ALTER TABLE users ADD COLUMN business_unit_id UUID REFERENCES business_units(id);
EXCEPTION
  WHEN duplicate_column THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_users_business_unit_id ON users(business_unit_id);

-- 4. Applications: add target_bu_id (nullable; NULL = Global). icon_url already in 001.
DO $$
BEGIN
  ALTER TABLE applications ADD COLUMN target_bu_id UUID REFERENCES business_units(id);
EXCEPTION
  WHEN duplicate_column THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_applications_target_bu_id ON applications(target_bu_id);

-- 5. SSO access logs (adoption rate + security)
CREATE TABLE IF NOT EXISTS sso_access_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  application_id UUID NOT NULL REFERENCES applications(id),
  outcome VARCHAR(32) NOT NULL,
  ip_address VARCHAR(45),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sso_access_logs_user ON sso_access_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_sso_access_logs_created ON sso_access_logs(created_at);

-- 6. Seed default domain for local dev (so first user can register)
INSERT INTO allowed_domains (domain)
SELECT 'example.com'
WHERE NOT EXISTS (SELECT 1 FROM allowed_domains WHERE domain = 'example.com');

-- 7. Seed one default Business Unit (optional, for existing users/apps)
INSERT INTO business_units (name)
SELECT 'Default'
WHERE NOT EXISTS (SELECT 1 FROM business_units WHERE name = 'Default');
