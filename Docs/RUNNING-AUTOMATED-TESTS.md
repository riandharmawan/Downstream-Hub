# Running the Automated Test Suite

Use this document when you want to **install dependencies and run the automated integration tests** for the Downstream Hub API. You can refer an AI assistant or a colleague to this file: *“Follow the steps in docs/RUNNING-AUTOMATED-TESTS.md.”*

---

## What the suite is

- **Location:** Backend API only (`backend/`).
- **Stack:** Jest + Supertest; tests live in `backend/src/__tests__/integration/`.
- **Scope:** Integration tests against the Express app (health, auth validation, protected routes, SSO, settings, applications, allowed domains, business units, users). See **TEST-PLAN.md** §3 for the full scenario list.

---

## Prerequisites

- **Node.js** and **npm** available (no admin required for install if you have write access to the project folder).
- **Optional:** A working **PostgreSQL** instance and `DATABASE_URL` if you want DB-dependent tests (e.g. registration-options 200, domain-not-allowed 400) to run. Without `DATABASE_URL`, those tests are skipped or accept 500.

---

## Steps

### 1. Install dependencies

From the **repository root** (or from `backend/`):

```bash
cd backend
npm install
```

This installs Jest and Supertest (and any other dependencies in `backend/package.json`). No global or admin install is required.

### 2. (Optional) Configure database for tests

If you have a database you want tests to use:

- Set **`DATABASE_URL`** in the environment (e.g. in `backend/.env` or in your shell).
- Example: `DATABASE_URL=postgresql://user:password@localhost:5432/downstream_hub_test`

If `DATABASE_URL` is not set or the DB is unreachable, the suite still runs; DB-dependent tests are skipped or tolerate 500 where applicable.

### 3. Run the test suite

From the **`backend/`** directory:

```bash
npm test
```

This runs Jest in band with the project’s `jest.config.js` (e.g. `**/__tests__/**/*.test.js` and `*.integration.test.js`).

### 4. Interpret results

- **Pass:** All tests green; exit code 0.
- **Fail:** Check the printed output for which test failed and why (e.g. DB connection, env, or assertion).
- **Open handles:** Jest may report open handles (e.g. DB pool); the config uses `forceExit` so the process still exits. For a clean shutdown in the future, ensure `afterAll` closes the pool (already done in the integration test file).

---

## Quick reference (copy-paste)

```bash
cd backend
npm install
npm test
```

With a database (PowerShell example):

```powershell
cd backend
$env:DATABASE_URL = "postgresql://user:password@localhost:5432/downstream_hub_test"
npm install
npm test
```

---

## Related docs

- **TEST-PLAN.md** — Full test plan (unit, integration, E2E scenarios).
- **TESTING.md** — Manual testing steps (Phases A–D and password expiry).
