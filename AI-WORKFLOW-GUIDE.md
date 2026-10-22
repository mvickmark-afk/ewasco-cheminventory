# EWASCO AI Work Guide

This guide is for the next AI or engineer continuing this repository audit and fix work.

Repository:
- mvickmark-afk/ewasco-cheminventory

Current active workstream:
- PR #37: `Restore structured Settings centre and traceable release checks`
- Branch: `fix/settings-configuration-centre-and-sds-release`

Goal:
- Fix the failing repository-safety branch checks.
- Keep the work scoped to settings, SDS validation, and release safety.
- Do not claim live login or deployment success without live Railway evidence.

## 1. Start here

1. Clone or update the repo.
2. Check out the correct active branch:
   ```bash
   git checkout fix/settings-configuration-centre-and-sds-release
   ```
3. Confirm clean state:
   ```bash
   git status
   git branch --show-current
   git log --oneline -n 10
   ```

## 2. Run the repo checks locally

Run inside `server/`:

```bash
cd server
npm ci
npm test
```

If tests are skipped because a DB is needed, make sure the env var exists:

```bash
export TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/ewasco_test
```

## 3. Highest-priority files to inspect first

These are the most relevant files for the current fix branch:

- `server/scripts/verify-build.mjs`
- `server/test/deployment-safety.test.js`
- `server/public/app.js`
- `server/public/api-client.js`
- `server/public/validators.js`
- `server/src/server.js`
- `server/src/sds.js`
- `server/src/permissions.js`
- `server/src/migrate.js`
- `.github/workflows/repository-safety.yml`

Do not start by rewriting architecture. First fix the failing repository-safety checks.

## 4. Scope rules

Keep the changes narrow and evidence-based.

Do not:
- merge directly to `main`
- create unrelated refactors
- edit production data or secrets
- claim production success without live verification
- weaken tests to make CI green

## 5. What the branch is trying to fix

The current branch is about:
- Settings centre restoration
- API-backed settings editing
- service readiness indicators
- frontend asset versioning
- SDS upload diagnostics and validation
- release safety verification
- request tracing / auditability

Related previous PRs to understand but not blindly chase:
- PR #36: request traceability and SDS upload diagnostics
- PR #33: SDS validation, Settings UI, and audit traceability
- PR #17: SDS file type detection fix
- PR #13: SDS partial review

The current active branch is the directly relevant one; keep work focused there unless logs prove otherwise.

## 6. Local debugging sequence

When `npm test` fails:

1. Read the exact failing assertion.
2. Open the failing file.
3. Confirm whether the failure is due to:
   - stale string match
   - missing route or API contract
   - script version mismatch
   - wrong frontend/backend contract
   - missing settings editor
   - invalid SDS validation logic
4. Patch only the root cause.
5. Re-run the same test, then the full `npm test`.

## 7. Production verification order

Only after local checks pass should production verification happen.

Check:
- current Railway commit SHA
- app health endpoint: `/healthz`
- readiness endpoint: `/readyz`
- session cookie behavior
- CSRF and auth flow
- Settings page loads through the API
- SDS allowed files are accepted and invalid ones are rejected
- actual deployed frontend script versions match the intended asset version

Do not claim live login works unless the live app is tested with a real account and session.

## 8. Required evidence before calling a fix complete

A fix is not complete unless all of these are true:
- local repo checks pass
- branch passes repository-safety workflow
- login path is verified locally or in live deployment
- session and auth behavior are tested
- Settings page behavior is tested
- SDS validation is tested
- production runtime evidence confirms the app is using the correct commit/version

## 9. Production access checklist

If production access is available, verify:

```bash
curl -i https://<live-url>/healthz
curl -i https://<live-url>/readyz
```

Check:
- environment variables names (not secrets)
- app start command
- port binding
- Postgres connectivity
- app commit SHA
- frontend script version query strings
- Cloudflare status (if relevant)

## 10. Good commit hygiene

Keep commits small and reviewable.

Examples:
- `fix: restore settings API-backed editor contract`
- `fix: align SDS validator with backend file checks`
- `test: add repository-safety regression for settings route`

Do not mix unrelated refactors into one branch.

## 11. Working rules for the next AI

- Start with the failing CI, not with speculation.
- Prefer the most recent active branch tied to the issue.
- Verify local repo state before editing.
- Fix root cause, not symptom.
- Run the same test repeatedly until it passes.
- Keep evidence, not assumptions.
- Do not claim live success without actual deployment evidence.

## 12. Practical command list

```bash
git checkout fix/settings-configuration-centre-and-sds-release
git status
cd server
npm ci
npm test
```

If certain tests require DB access:

```bash
export TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/ewasco_test
npm test
```

## 13. Final rule

Production readiness is only valid when the code is green locally and the deployed app is verified live. Until that is confirmed, treat login and deployment claims as unverified.

---

This guide is intentionally narrow and practical for the current repository state.
