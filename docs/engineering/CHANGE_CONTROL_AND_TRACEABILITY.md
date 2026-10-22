# Change control, traceability and audit conventions

## Purpose

This repository supports laboratory inventory and LIMS workflows. Changes must be reviewable, reproducible, and traceable from a reported problem through source changes, verification, release, and (where applicable) a recorded laboratory action.

## Required change record

Every non-trivial change should include these fields in its pull request description:

- **Issue / symptom:** exact user-visible or operational problem; include a redacted example where useful.
- **Impact and risk:** affected workflow, user roles, data integrity, security, and availability.
- **Root-cause status:** confirmed by source/test evidence, or explicitly marked as a hypothesis.
- **Files and interfaces changed:** frontend, API, database, migration, configuration, or documentation.
- **Verification:** commands and tests actually run, their outcomes, and any checks not run.
- **Data and migration impact:** state whether schema/data changes are included; never imply a migration is harmless without checking it.
- **Release and rollback:** commit/PR, deployment target, verification after deployment, and the rollback route.
- **Follow-up debt:** known limitations that remain open.

## Engineering structure

- Keep browser validation in small, independently tested helpers; enforce security, authorization, and business rules again on the server.
- Keep API adapters explicit. Add build checks whenever a frontend call or backend contract changes.
- Prefer small changes with one clear purpose. Avoid combining schema migrations with unrelated UI changes.
- Do not treat the root `Index.html` localStorage demo as the deployed application. The production frontend is `server/public/index.html`, `server/public/app.js`, `server/public/api-client.js`, and `server/public/validators.js`.
- When changing a production frontend JavaScript asset, bump the shared query-string version on all three script tags in `server/public/index.html`. The build verifier checks that the versions are present and match.

## Audit and operational traceability

- State-changing business actions must use the authenticated API and its server-side authorization and audit mechanism; do not treat browser logs as an audit record.
- Audit entries should identify the authenticated actor, organization, action, entity/record, timestamp, and a minimal before/after or change summary where appropriate. Avoid logging passwords, session tokens, secrets, or unnecessary personal data.
- For request-level diagnosis, use a correlation/request ID that can be followed across application logs and error responses. Do not claim this is implemented until middleware, log emission, and tests verify it.
- File workflows should retain enough metadata to trace the uploaded file, validation outcome, extraction/review decision, actor, and resulting record/version. Preserve the original file and its version history where the feature contract requires it.
- Never silently replace ambiguous analytical or chemical metadata with a guess. Return an actionable validation error and preserve a review path.
- Audit records should be append-only by design; database-level protections and privileged-administrator threat controls remain a separate hardening requirement.

## Release checklist

1. Confirm the change is on a feature branch and review the diff.
2. Run the repository build verifier and the focused tests.
3. Run the full test suite, including PostgreSQL-backed tests when the environment supports them.
4. Check API and UI behavior against the production entry point, not the legacy demo.
5. Verify migration compatibility and rollback needs if schema or persistent data changes.
6. Merge only after required checks pass; confirm the deployed commit and health check afterward.
7. Record unresolved risks and the deployed commit in the release note or pull request.

## Current scope note

This document defines a working standard, not a claim that every control is already implemented. Request correlation IDs, stronger database-enforced audit immutability, MFA, and comprehensive browser-to-database end-to-end tests must be tracked and verified as separate engineering work.
