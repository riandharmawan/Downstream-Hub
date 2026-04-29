-- Hub OIDC id_token: email_verified claim is derived from inbox proof (magic-link SSO verification).

DO $$ BEGIN
  ALTER TABLE users ADD COLUMN hub_oidc_email_verified_at TIMESTAMPTZ;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- Users who already completed Hub-side OIDC linking are treated as verified for OIDC claims.
UPDATE users
SET hub_oidc_email_verified_at = oidc_linked_at
WHERE oidc_linked_at IS NOT NULL
  AND hub_oidc_email_verified_at IS NULL
  AND deleted_at IS NULL;
