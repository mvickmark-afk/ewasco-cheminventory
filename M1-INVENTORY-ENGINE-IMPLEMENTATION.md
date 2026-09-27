# M1 Inventory Engine — Implementation Record

## Date

2026-09-27

## Scope

This document records the complete M1 inventory-engine work implemented on the `feature/chemical-inventory-workflow` branch.

The objective was to move the application away from treating a chemical's generic `quantity` field as authoritative stock and establish a proper laboratory inventory domain.

## Product architecture

The product is being developed as a reusable Laboratory Chemical & Inventory Management System.

EWASCO is the first organisation, but EWASCO-specific business rules must not be embedded into the core product.

The intended organisation model is:

`Organisation -> Sites/Laboratories -> Users and operational records`

All operational inventory data is organisation-scoped.

## Domain model

The authoritative inventory model is:

`Chemical Master -> Batch/Lot -> Inventory Transactions -> Calculated Stock`

### Chemical master

The chemical master describes the substance, including identity, CAS number, hazard information, default unit and policy metadata.

It does not act as the authoritative stock ledger.

### Batch/Lot

A batch represents a physical quantity received into the organisation.

The batch model records:

- organisation
- chemical
- lot number
- receipt timestamp
- expiry date
- unit
- received quantity
- location
- metadata
- creating user

A chemical/lot combination is unique within an organisation.

### Inventory transaction

Every stock movement is represented as a transaction.

Supported transaction types are:

- `RECEIVE`
- `ISSUE`
- `RETURN`
- `TRANSFER`
- `ADJUSTMENT`
- `DISPOSAL`

All six transaction types are implemented. `TRANSFER` currently supports whole-batch moves only; partial transfers are deliberately rejected because the batch model stores one location per batch.

The transaction records:

- organisation
- transaction type
- chemical
- batch
- quantity
- unit
- reference
- reason
- actor
- timestamp
- metadata

Stock is calculated from transactions rather than maintained through arbitrary quantity edits.

## Receiving workflow

The new endpoint:

`POST /api/inventory/receive`

The receiving workflow:

1. Authenticates the user.
2. Checks the user's permission to create batch inventory.
3. Validates chemical ID, lot number, quantity and unit.
4. Confirms that the chemical belongs to the user's organisation.
5. Prevents duplicate chemical/lot combinations.
6. Creates the inventory batch.
7. Creates a `RECEIVE` transaction.
8. Creates an audit event.
9. Commits the complete operation as one database transaction.

If any step fails, the database transaction is rolled back.

## FIFO issue workflow

The new endpoint:

`POST /api/inventory/issue`

The issue workflow:

1. Authenticates the user.
2. Checks permission.
3. Validates chemical, quantity and unit.
4. Confirms the chemical belongs to the organisation.
5. Finds matching batches.
6. Excludes expired batches.
7. Orders batches by receipt time, then batch ID.
8. Locks eligible batch rows with PostgreSQL `FOR UPDATE`.
9. Calculates available quantity from the transaction ledger.
10. Allocates stock from the oldest eligible batch first.
11. Creates one or more `ISSUE` transactions.
12. Writes an audit event.
13. Commits atomically.

If the requested quantity cannot be fulfilled, the entire operation is rolled back and no partial issue remains.

## Concurrency protection

The issue operation runs inside a database transaction and locks the candidate batch rows.

This is intended to prevent two simultaneous users from consuming the same apparent stock.

This is covered by the PostgreSQL integration suite in CI, including a concurrent-issue test against PostgreSQL 16.

## Expiry handling

Expiry is a batch property.

The FIFO issue query currently excludes batches whose expiry date is before the current database date.

This establishes the initial safety rule while leaving the warning/quarantine policy configurable for later product work.

## Stock endpoint

The new endpoint:

`GET /api/inventory/stock/:chemicalId`

It returns organisation-scoped batch balances calculated from the ledger.

For each batch it exposes:

- batch ID
- chemical ID
- lot number
- receipt time
- expiry
- unit
- location
- received quantity
- available quantity

## Transaction history

The new endpoint:

`GET /api/inventory/transactions/:chemicalId`

It returns organisation-scoped transaction history for the chemical, including:

- transaction type
- chemical
- batch
- quantity
- unit
- reference
- reason
- actor
- timestamp
- metadata

The endpoint is limited to the most recent 500 transactions.

## Backup

The organisation backup endpoint was extended to include:

- generic records
- inventory batches
- inventory transactions

This prevents the new inventory ledger from being omitted from organisation backups.

## Testing

The FIFO allocation logic is separated into a testable function:

`allocateFifo(batches, requestedQuantity, getBalance)`

Unit tests cover oldest-batch-first allocation, multi-batch allocation, depleted batches and shortages.

PostgreSQL integration tests cover receiving, duplicate lots, FIFO issue, insufficient-stock rollback, organisation isolation, concurrent issue protection, returns, adjustments, disposal, whole-batch transfer, negative-stock prevention, expired-batch exclusion, transaction history and inventory RBAC.

GitHub Actions Run #23 for commit `f4b03c4c53d32cf1f6428b365d3d4c4086271a5d` completed successfully on 2026-09-27. PostgreSQL 16, migration and the complete `npm test` suite passed. Subsequent RBAC coverage commits extend the test suite and require a new CI run before this document is considered current.

## Current branch state

The current branch head includes the M1 inventory engine, PostgreSQL integration coverage and the corrected batch-based RBAC mapping. Recent verification commits are:

- `54de0e4e88b1578484f7ba98a33eccdfa8222714` — align inventory mutations with batch permissions
- `f4b03c4c53d32cf1f6428b365d3d4c4086271a5d` — expand inventory RBAC integration coverage
- `60a222ef9356250e0e25dff57454048ffd38da93` — add complete inventory RBAC unit coverage
- `6673230dcc75e153ad22119ac61dcf84b13cfdaf` — verify Storekeeper inventory workflow permissions

Earlier M0 architecture work also added:

- `PRODUCT-ARCHITECTURE.md`
- updated `CHEMICAL-INVENTORY.md`
- removal of duplicate Wrangler deployment configurations

## Important limitations

The following are deliberately not being treated as finished:

- Partial-batch transfer workflow (current transfer safely supports whole-batch moves only)
- organisation-configurable adjustment approval policy
- full PostgreSQL integration tests
- concurrency integration tests
- end-to-end browser tests
- production deployment verification
- complete inventory UI
- organisation-configurable expiry/quarantine policy
- unit conversion between chemically compatible units
- formal inventory reconciliation workflow

These are next-stage requirements, not silently assumed to be complete.

## Next M1 work

The immediate next implementation is:

### Remaining M1/M2 verification

The transaction engine itself is implemented and has PostgreSQL CI coverage. Remaining hardening work is outside the core ledger implementation:

1. Test the real HTTP authentication/session/CSRF layer rather than only the inventory route harness.
2. Add backup/restore verification rather than only backup export coverage.
3. Add audit-log integrity and organisation-isolation tests at the full API layer.
4. Verify migration upgrade behaviour from representative existing database states.
5. Define and enforce unit-conversion rules if cross-unit operations are required.

### Workflow UI

The generic JSON editor should be replaced by:

- Receive Stock
- Stock by Chemical
- Batch details
- Issue/Consume
- Transaction history
- Adjust
- Transfer
- Dispose

## Product principle

The core product promise is:

> Know what chemicals the laboratory has, where they are, how much remains, which batch the stock came from, when it expires, who moved it, and why.

The system should preserve that traceability even when the interface becomes simpler.

## Verification status

M1 transaction workflows implemented: RECEIVE, ISSUE, RETURN, TRANSFER (whole batch), ADJUSTMENT and DISPOSAL.

PostgreSQL integration and concurrency coverage: implemented and passing in CI as of Run #23 for the earlier RBAC commit; the two newer RBAC coverage commits require their own CI completion.

M1 backend implementation: substantially complete, with final security/backup/migration verification still outstanding.

Production-ready inventory engine: NOT YET.

The next work should continue from the existing branch rather than creating a parallel inventory implementation.
