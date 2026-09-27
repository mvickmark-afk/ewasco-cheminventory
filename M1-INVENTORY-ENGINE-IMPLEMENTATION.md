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

Only the first two are implemented in the current increment. The remaining types are the next M1 work package.

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

This still requires full PostgreSQL integration testing before production use.

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

The FIFO allocation logic was separated into a testable function:

`allocateFifo(batches, requestedQuantity, getBalance)`

Tests were added for:

1. oldest-batch-first allocation;
2. allocation across multiple batches;
3. skipping depleted batches;
4. reporting a shortage.

These are unit-level tests.

The repository does not currently provide a CI status for this branch, so these changes have not been represented as having a successful CI run.

## Current commits

The M1 work was implemented through these branch commits:

- `21f212d` — inventory batch and transaction database schema
- `7356bed` — receiving/FIFO inventory engine
- `ab601ef` — inventory route registration
- `3ff577f` — expiry-aware FIFO and batch capacity correction
- `47295a2` — isolated FIFO allocation logic
- `6d5f001` — FIFO unit tests
- `39c9eb3` — inventory ledger added to backups
- `4b75d44` — transaction history endpoint and access control

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

### 1. RETURN — implemented

Return unused material to an existing batch while preserving the transaction history.

### 2. TRANSFER — implemented for whole batches

Move a complete batch between locations without changing total organisational stock. Partial-batch transfer is intentionally rejected until location-level stock is modelled explicitly.

### 3. ADJUSTMENT — implemented

Provide an authorised correction mechanism that creates an adjustment transaction rather than editing historical transactions. A reason is mandatory and decreases cannot create negative stock.

### 4. DISPOSAL — implemented

Remove stock through a traceable disposal transaction with mandatory reason and actor.

### 5. Integration tests

Test receiving, issuing, insufficient stock, expiry, organisation isolation, concurrent issue and transaction rollback against PostgreSQL.

### 6. Workflow UI

Only after the transaction engine is sufficiently verified should the generic JSON editor be replaced by:

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

M1 complete: NOT YET — integration/concurrency testing and workflow UI remain.

Production-ready inventory engine: NOT YET.

The next work should continue from the existing branch rather than creating a parallel inventory implementation.
