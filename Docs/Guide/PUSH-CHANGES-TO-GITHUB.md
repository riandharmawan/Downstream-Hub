# Push changes to GitHub (`sit` branch)

Use this when you want to push local updates from your machine to `origin/sit`.

## Quick steps

```bash
cd /opt/downstream-hub
git status
git add <files-or-directories>
git commit -m "your commit message"
git push origin sit
```

## Recommended safe flow

```bash
cd /opt/downstream-hub

# 1) Ensure you are on sit and up to date
git fetch origin
git checkout sit
git pull origin sit

# 2) Review local changes
git status
git diff

# 3) Stage specific files
git add deploy/docker-compose.frontend.yml deploy/nginx-frontend-with-api-proxy.conf
git add Docs/Guide/STAGING-DEPLOY-TWO-SERVERS.md Docs/Guide/STAGING-PROXY-SERVER-CONFIG.md

# 4) Commit and push
git commit -m "chore(staging): switch to app-proxy on 3010 and add runbooks"
git push origin sit
```

## Verify push

```bash
git status
git log -1 --oneline
```

Expected:
- `git status` shows clean working tree (or only intentionally untracked files).
- Latest commit appears on `https://github.com/riandharmawan/Downstream-Hub/tree/sit`.

## Notes

- Do not commit `.env`, private keys, or credentials files.
- If push is rejected, run `git pull --rebase origin sit`, resolve conflicts, then push again.
