# Push Downstream Hub to GitHub

Use these steps to push this project to: **https://github.com/riandharmawan/Downstream-Hub**

---

## Prerequisites

- **Git** installed on your machine ([git-scm.com](https://git-scm.com)).
- **GitHub access:** You must be able to push to `riandharmawan/Downstream-Hub` (repo exists and you have write access). If the repo doesn’t exist yet, create it on GitHub first (empty repo, no README).

---

## Commands (run in project root)

Open a terminal (PowerShell, CMD, or Git Bash) and go to the project folder:

```bash
cd "c:\Users\04125050828\Documents\Workspace\Cursor\Downstream Hub"
```

Then run:

```bash
# 1. Initialize git (if not already)
git init

# 2. Add the GitHub remote
git remote add origin https://github.com/riandharmawan/Downstream-Hub.git

# 3. Stage all files (.env is ignored by .gitignore)
git add .

# 4. First commit
git commit -m "Initial commit: Downstream Hub"

# 5. Push to GitHub (main branch)
git branch -M main
git push -u origin main
```

If the repo already has a default branch named `main`, step 5 is enough. If GitHub created the repo with `master`, use:

```bash
git push -u origin main
```

(or use `master` instead of `main` if you prefer).

---

## If the repo already has content (e.g. README)

If you created the repo on GitHub with a README or license and you want to replace it with this code:

```bash
git pull origin main --allow-unrelated-histories
# Resolve any merge conflicts if prompted, then:
git push -u origin main
```

Or, to overwrite the remote with your local version (use only if you’re sure):

```bash
git push -u origin main --force
```

---

## Authentication

- **HTTPS:** When you `git push`, Git will ask for your GitHub username and **password**. Use a **Personal Access Token (PAT)** as the password, not your account password. Create one: GitHub → Settings → Developer settings → Personal access tokens.
- **SSH:** If you use SSH keys, change the remote to:  
  `git remote set-url origin git@github.com:riandharmawan/Downstream-Hub.git`  
  then run `git push -u origin main` as above.

---

## Check before pushing

- `.env` is in `.gitignore` (it is), so it will **not** be committed. Only `.env.example` is tracked.
- Do not remove `.env` from `.gitignore`; keep secrets out of the repo.

After a successful push, your code will be at: **https://github.com/riandharmawan/Downstream-Hub**
