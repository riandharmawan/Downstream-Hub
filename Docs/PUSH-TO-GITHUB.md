# Push Downstream Hub to GitHub (sit branch)

**Repository:** https://github.com/riandharmawan/Downstream-Hub  
**Target branch:** `sit` (not `main`)

---

## One-time setup (if the folder is not yet a git repo)

Run these in the project root (`Downstream Hub`):

```bash
# 1. Initialize git (only if not already a repo)
git init

# 2. Add the GitHub remote (use "origin" or another name)
git remote add origin https://github.com/riandharmawan/Downstream-Hub.git

# 3. Create and switch to the "sit" branch
git checkout -b sit
```

---

## Push to the sit branch

```bash
# 1. Stage all files (respects .gitignore; .env is ignored)
git add .

# 2. Commit
git commit -m "Initial push to sit: Downstream Hub with rate limiting, security policy, pentest report"

# 3. Push to the "sit" branch on GitHub (creates "sit" on remote if needed)
git push -u origin sit
```

If the remote already has a `sit` branch and you want to overwrite it with your local state:

```bash
git push -u origin sit --force
```

Use `--force` only when you intend to replace the remote `sit` branch.

---

## If the repo is already initialized and has a different branch

```bash
# See current branch
git branch

# If you're on main (or another branch), create/switch to sit
git checkout -b sit

# Add and commit any uncommitted changes
git add .
git status
git commit -m "Your commit message"

# Set upstream and push to sit
git push -u origin sit
```

---

## Notes

- **.env** is in `.gitignore` and will not be pushed (use `.env.example` as a template on the repo).
- To use SSH instead of HTTPS, set:  
  `git remote set-url origin git@github.com:riandharmawan/Downstream-Hub.git`  
  then run `git push -u origin sit` as above.
