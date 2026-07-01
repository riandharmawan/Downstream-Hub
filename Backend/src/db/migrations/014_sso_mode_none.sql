-- Replace legacy bridge SSO mode with none (direct redirect, no SSO hand-off)

UPDATE applications SET sso_mode = 'none' WHERE sso_mode = 'bridge';

ALTER TABLE applications ALTER COLUMN sso_mode SET DEFAULT 'none';
