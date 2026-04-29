# Staging troubleshooting — force reset user password

Use this runbook when Forgot Password is delayed or unavailable and you have server access.

## Important

- Do **not** store plaintext passwords in Git.
- Use a temporary password only, then rotate it after successful login.
- If a password was shared in chat/ticket, treat it as compromised and change it again.

## Target user

- Email: `rian.dharmawan@energi-up.com`

## Force-reset script (backend server `.57`)

```bash
cd /opt/downstream-hub/Backend

# 1) Generate bcrypt hash inside backend container
NEW_HASH=$(docker exec downstream-hub-api node -e "require('bcryptjs').hash('REPLACE_WITH_TEMP_PASSWORD',10).then(h=>process.stdout.write(h))")
echo "$NEW_HASH"

# 2) Update user password in Postgres
docker exec -i downstream-hub-db psql -U hub -d downstream_hub <<SQL
UPDATE users
SET password_hash = '$NEW_HASH',
    password_changed_at = now(),
    token_version = COALESCE(token_version,0) + 1,
    failed_login_attempts = 0,
    locked_until = NULL
WHERE email = 'rian.dharmawan@energi-up.com'
  AND deleted_at IS NULL;

SELECT id, email, length(password_hash) AS hash_len, password_changed_at, token_version
FROM users
WHERE email = 'rian.dharmawan@energi-up.com';
SQL
```

## Expected result

- `UPDATE 1`
- `hash_len = 60`
- `token_version` increments

## Post-reset checks

1. Login with the temporary password.
2. Change password immediately from the app profile/change-password flow.
3. Re-test Forgot Password after SMTP is confirmed.

