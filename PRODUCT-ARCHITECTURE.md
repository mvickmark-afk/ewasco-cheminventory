# Product Architecture

## Product direction

This repository is the foundation for a reusable Laboratory Chemical & Inventory Management System. EWASCO is the first organisation using it, but the application must not encode EWASCO-specific business rules into the core domain.

The product is organisation-scoped:

Organisation -> Sites/Laboratories -> Users and operational records.

The same application and database model must support water utilities, commercial laboratories, hospitals, universities, research laboratories, and other laboratory organisations through configuration rather than code forks.

## Architecture decisions

### 1. Tenant boundary

Every operational record is owned by an organisation. Existing PostgreSQL records already enforce this with `organization_id`.

Application code must always scope reads, writes, audit events, SDS records, and future inventory transactions to the authenticated user's organisation.

Do not introduce cross-organisation queries into normal application workflows.

### 2. Chemical master is not stock

A chemical is the reusable master definition:

- name
- CAS number
- hazard classification
- default unit
- storage/location metadata
- minimum-stock policy
- organisation-specific metadata

A batch/lot is a physical quantity received at a particular time. Batch data must eventually include supplier, lot number, received quantity, remaining quantity, manufacture/expiry information, and receiving evidence.

A chemical record must not become the authoritative ledger of stock.

### 3. Stock is transaction-derived

Authoritative stock will be calculated from immutable inventory transactions, not from arbitrary quantity edits.

The planned transaction types are:

- RECEIVE
- ISSUE
- RETURN
- TRANSFER
- ADJUSTMENT
- DISPOSAL

Every stock-changing transaction must identify the organisation, chemical, affected batch where applicable, quantity, unit, actor, timestamp, reason/reference, and audit information.

Corrections must be represented as new transactions rather than silently rewriting historical movements.

### 4. FIFO allocation

For chemicals where FIFO is applicable, an issue/consumption request will allocate from the oldest eligible available batch first.

Allocation must be performed server-side inside a database transaction so two concurrent users cannot consume the same stock.

The engine must reject an issue when available stock is insufficient unless an explicitly authorised adjustment workflow is used.

### 5. Expiry and safety

Expiry is a batch property, not merely a chemical-master property.

The system should distinguish:

- expired
- expiring soon
- usable
- quarantined/restricted

The exact policy and warning period should be organisation-configurable.

### 6. Roles and permissions

Permissions remain server-side and organisation-scoped.

The current roles are a starting RBAC model:

- Administrator
- Laboratory Manager
- Analyst/Chemist
- Storekeeper

Future organisations may need additional roles. Role names and permissions should therefore be treated as product configuration where practical rather than hard-coded assumptions in the UI.

### 7. Auditability

Security and inventory history are different concerns.

Authentication/session events and administrative changes require audit records. Inventory movements must additionally have a domain transaction history that cannot be replaced by ordinary CRUD updates.

The product should describe its compliance posture as traceability/alignment features unless a specific standard and implementation have been formally verified.

### 8. Deployment boundary

The canonical production architecture is:

Browser UI -> Express API -> PostgreSQL -> private file/object storage.

Cloudflare/static hosting may be used for a frontend-only deployment, but it is not the canonical backend architecture for this repository because the application requires PostgreSQL, authenticated sessions, transactions, audit records, and private SDS files.

The duplicate Wrangler configurations are therefore not part of the canonical deployment path and are removed in this increment.

## Development sequence

### M0 — Architecture foundation

Freeze the organisation boundary, domain vocabulary, transaction principles, permissions, API conventions, and deployment boundary.

### M1 — Inventory engine

Implement the chemical master, batches, receiving, immutable stock ledger, FIFO allocation, consumption/issue, returns, transfers, adjustments, disposal, and concurrency tests.

### M2 — Security and audit hardening

Complete the existing authentication, CSRF, RBAC, organisation isolation, audit, SDS, backup/restore, and deployment verification work.

### M3 — Laboratory modules

Add equipment/calibration, reagents/preparations, suppliers/procurement, waste, water-quality records, reporting, and safety workflows.

### M4 — Production workflow UI

Replace generic record editing with task-oriented workflows: Dashboard, Stock, Receive, Issue, Transfer, Disposal, Safety, Quality, Reports, and Administration.

### M5 — Verification

Require unit, integration, end-to-end, security, migration, backup/restore, concurrency, and deployment verification before production release.

### M6 — Productisation

Add organisation onboarding, configurable sites/departments, import/export, configurable policies, documentation, demo data, and deployment options suitable for external laboratory organisations.

## Current increment

This branch is deliberately not implementing stock-ledger behaviour yet. The existing chemical validation remains a boundary check for the transitional generic-record layer.

The next implementation increment must build the inventory domain separately from generic CRUD rather than adding more quantity fields to the chemical record.
