# Backup and Recovery CI Verification — 2026-09-27

## Run #100 result

GitHub Actions **Server tests — Run #100** completed with failure; the recovery test defect was corrected.

- 23 tests
- 22 passed
- 1 failed
- Database migration passed
- Failing test: HTTP authentication and CSRF protection through the real server

The failure was a PostgreSQL duplicate-primary-key error on `inventory_batches.id`.

## Root cause

The clean-organisation recovery test attempted to insert the backup batch UUIDs into the same database after the API restore had already inserted those UUIDs. Although the target organisation was different, `inventory_batches.id` is globally unique.

## Fix

Commit `8d8b05f13c7cfb63c13979ffcf7902ac6f3f46ee` changes the clean recovery test to:

- generate new batch UUIDs;
- map original batch IDs to restored batch IDs;
- remap transaction `batch_id` references;
- generate new transaction UUIDs;
- compare recovered domain data without requiring globally unique IDs to remain identical.

The earlier production restore ID-remapping fix is in commit `cf64e1992c747479e3df0f5e11b2e6cd6a49a6c4`.

## Verification target

The next CI run must pass all 23 tests, including the recovery round-trip and database invariant checks.

Production-readiness assessment remains blocked until CI is green.

## Verified correction

Commit `8d8b05f13c7cfb63c13979ffcf7902ac6f3f46ee` passed Server tests Run #102. The run completed successfully with 23/23 tests passing, including backup manifest validation, HTTP authentication/CSRF, database invariants, FIFO/concurrency, RBAC, API restore and clean-organisation recovery. The CI job also reported 0 npm audit vulnerabilities.

## Restore provenance hardening

Subsequent restore hardening clears `created_by` and `actor_id` on imported inventory rows rather than carrying user UUIDs from the source organisation into the recovered organisation. This prevents cross-organisation user provenance references.
