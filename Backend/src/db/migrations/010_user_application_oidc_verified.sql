-- Per-application OIDC inbox verification (strict per-app email_verified on id_token).

CREATE TABLE IF NOT EXISTS user_application_oidc_email_verified (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  application_id UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  verified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, application_id)
);

CREATE INDEX IF NOT EXISTS idx_user_app_oidc_verified_app
  ON user_application_oidc_email_verified(application_id, user_id);

DO $$ BEGIN
  ALTER TABLE sso_link_email_verifications ADD COLUMN application_id UUID REFERENCES applications(id);
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_sso_link_email_verifications_application
  ON sso_link_email_verifications(application_id)
  WHERE application_id IS NOT NULL;

-- Optional parity: users who already had global Hub verification get a row per active OIDC app.
INSERT INTO user_application_oidc_email_verified (user_id, application_id, verified_at)
SELECT u.id, a.id, u.hub_oidc_email_verified_at
FROM users u
CROSS JOIN applications a
WHERE u.hub_oidc_email_verified_at IS NOT NULL
  AND u.deleted_at IS NULL
  AND a.deleted_at IS NULL
  AND a.sso_mode = 'oidc'
ON CONFLICT (user_id, application_id) DO NOTHING;
