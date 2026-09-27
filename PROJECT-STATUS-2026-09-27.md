# Project Status — 27 September 2026

## Current branch

`feature/chemical-inventory-workflow`

## What is complete

The backend inventory engine now implements:

- RECEIVE
- ISSUE with FIFO allocation
- RETURN
- ADJUSTMENT
- DISPOSAL
- TRANSFER for complete batches
- Batch-level expiry exclusion during issue
- Organisation-scoped stock and transactions
- PostgreSQL row locking for concurrent issue protection
- Ledger-derived stock
- Audit events for inventory mutations
- Server-side RBAC
- Backup export including inventory batches and transactions

The product architecture treats EWASCO as the first organisation rather than hardcoding EWASCO into the core domain.

The chemical master is separate from batch/lot inventory. Stock is derived from inventory transactions.

## Verification completed

CI Run #23 passed on 27 September 2026 for commit `f4b03c4c53d32cf1f6428b365d3d4c4086271a5d`. A later CI Run #39 exposed two test-harness defects introduced with the frontend/RBAC verification: the frontend smoke-test regex was invalid JavaScript, and the Storekeeper RBAC test reused a fixed lot number. Both were corrected in commits `4a14736139bf73ddc4046f8294afe4d4bf8a54d1` and `7aa98f91d309de15f7df848e3ee774f3b1e14d99`. The corrected commits are now included in CI Run #53, which is currently queued; they will not be treated as verified until that run completes successfully.

That run included PostgreSQL 16, database migration, unit tests, PostgreSQL integration tests, FIFO tests, organisation isolation, insufficient-stock rollback, concurrent issue protection, expiry exclusion, transaction history and inventory RBAC coverage present at that commit.

Additional RBAC coverage was subsequently added for the Storekeeper workflow and the full permissions matrix.

## Frontend work started

The server-served frontend has now been replaced with a laboratory workflow interface.

Implemented frontend areas:

- Dashboard
- Stock
- Transactions
- Receive Stock
- Issue / Consume
- Return Stock
- Adjustment
- Disposal
- Whole-batch Transfer
- Chemicals
- Reagent Preparation
- Equipment
- Calibrations
- SDS / MSDS
- Waste
- Water Treatment
- Suppliers
- Procurement
- Consumption
- Settings

The frontend uses the existing authenticated API and does not store authentication tokens in browser storage.

The inventory UI uses the transaction engine as its source of truth instead of directly editing chemical quantities.

## Important design decisions

1. Stock is ledger-derived.
2. FIFO is server-side.
3. Expired batches are excluded from FIFO issue.
4. Inventory mutations are protected by server-side permissions.
5. Organisation boundaries are enforced by the API.
6. Whole-batch transfer is used until location-level split stock is modelled.
7. The UI must not bypass the API to alter inventory.
8. Generic record editing remains available for non-inventory modules while specialised workflows are built.

## Verification work in progress

- Added a real HTTP integration test covering login, database-backed session authentication, organisation identity, missing-CSRF rejection and valid-CSRF mutation.
- Corrected the dashboard to display the organisation name returned by the authenticated API rather than deriving an organisation name from the username.
- Unit handling in inventory issue/return/adjust/dispose/transfer is currently exact-unit matching; no implicit conversions are performed.

## Remaining verification

These are still open and must not be represented as complete:

1. Fresh CI verification after the latest test and HTTP-security changes.
2. Real HTTP authentication/session/CSRF integration tests.
3. Backup/restore verification. Backup export exists; restore verification is not complete.
4. Audit-log integrity and full API-level organisation-isolation tests.
5. Migration upgrade testing against representative existing database states.
6. Unit-conversion policy and enforcement.
7. Browser/E2E tests.
8. Production deployment verification.
9. Formal inventory reconciliation workflow.
10. Configurable expiry/quarantine policy.
11. Configurable adjustment approval policy.

## Frontend caveats

The current workflow UI is intentionally lightweight and server-served. It is a functional foundation, not yet a final visual/product polish pass.

The generic JSON editor is retained for modules whose specialised forms have not yet been implemented.

## Current direction

Continue frontend implementation while the remaining backend verification runs in parallel.

Priority order:

1. Finish CI verification for the latest commits.
2. Validate the new frontend against the actual API.
3. Add real authentication/CSRF tests.
4. Add backup/restore and audit verification.
5. Add browser/E2E coverage.
6. Polish responsive UI and workflow details.
7. Prepare deployment verification.

## Production status

**Not production-ready yet.**

The inventory backend is substantially implemented and has meaningful PostgreSQL integration coverage. Final security, recovery, migration, browser and deployment verification remain required before production release.
