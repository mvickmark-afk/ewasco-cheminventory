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

## Verification status

The backend verification gate is now green. Server tests Run #102 for commit `8d8b05f13c7cfb63c13979ffcf7902ac6f3f46ee` completed successfully with 23/23 tests passing. The suite covers backup manifest validation, tamper and relationship rejection, real HTTP authentication and CSRF, PostgreSQL inventory flows, FIFO, insufficient-stock rollback, organisation isolation, concurrent issue protection, expiry exclusion, RBAC, database invariants, frontend syntax checks, and clean-organisation recovery.

The recovery work verified the versioned SHA-256 backup manifest and controlled restore path. Restore remaps globally unique inventory IDs and batch references so a recovered organisation does not collide with source IDs. Restore provenance was hardened so imported inventory rows do not retain source-organisation user UUIDs.

The CI runner reported zero npm audit vulnerabilities. The workflow was subsequently moved from Node 20 to Node 22 LTS to remove the GitHub Actions Node 20 deprecation warning.

## Remaining production-readiness work

The core inventory/recovery verification gate is green, but the application should not yet be described as fully production-ready. Remaining items are operational/product gates rather than unresolved CI failures:

1. Production PostgreSQL backup/PITR and private upload-storage backup strategy.
2. Deployment verification with real TLS, explicit CORS, secure cookies, secrets, database connectivity and health checks.
3. Browser/E2E verification on supported mobile and desktop browsers.
4. Migration upgrade testing against a representative pre-existing database.
5. Formal inventory reconciliation and approval workflows.
6. Configurable expiry/quarantine and adjustment-approval policies.
7. User administration/bootstrap workflow for a newly restored organisation.
8. SDS/file-storage disaster-recovery verification; the JSON backup is not a full binary-file backup.

These are intentionally not marked complete until tested in their target environment.

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
