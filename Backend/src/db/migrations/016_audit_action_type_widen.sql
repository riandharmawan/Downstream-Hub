-- Widen audit_logs.action_type (LOGIN_MFA_MAGIC_LINK_VERIFY_FAILED is 36 chars; column was VARCHAR(32))
ALTER TABLE audit_logs
  ALTER COLUMN action_type TYPE VARCHAR(64);
