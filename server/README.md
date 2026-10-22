# EWASCO LIMS application server

## Runtime and source of truth

The production web application is served by this Node.js service from `server/public/`:

- `public/index.html` — shell, navigation and static asset loading.
- `public/app.js` — page renderers and user interactions.
- `public/api-client.js` — same-origin API adapter and request error handling.
- `public/validators.js` — browser-side convenience validation only; server validation remains authoritative.

The root `Index.html` is a legacy local-storage demo and is **not** the production frontend. Do not deploy it as the entry point or use it to infer live API behavior.

## Backend map

- `src/server.js` — application composition, authentication, sessions, CSRF, API middleware, legacy records and shared audit function.
- `src/permissions.js` — role and feature authorization rules.
- `src/sds.js` — SDS document extraction and lifecycle routes.
- `src/lims.js` and `src/lims-phases.js` — structured LIMS/QMS workflows.
- `src/migrate.js` and `sql/schema.sql` — transactional schema setup and migration verification.
- `test/` — automated unit/contract tests.
- `scripts/verify-build.mjs` — syntax checks and frontend/backend contract checks.

Keep changes within the appropriate module, and add a test or build contract for every bug fixed. Avoid adding a second implementation of a workflow in another file.

## Traceability and audit events

Each HTTP request receives a server-generated `X-Request-ID`. API request and error logs are JSON records; error responses include the same reference. The shared audit writer stores that ID in `audit_log.request_id`, allowing an operator to correlate an audit event with request logs. Use the request ID when investigating a report; do not log passwords, session cookies, CSRF tokens, document contents, or full request bodies.

Audit events should record the actor, organization, action, entity, record identifier, relevant before/after or decision metadata, timestamp, and request correlation ID. Avoid storing unnecessary personal data or full document content in `audit_log.data`. Schema changes must be additive/backwards-compatible and verified by the migration/build tests.

## Local verification

From `server/`:

```bash
npm ci
npm test
npm run migrate
npm start
```

The test command runs static build-contract checks and Node.js tests. Run `npm test` before opening a pull request. Database-backed behavior also needs CI coverage against PostgreSQL.

## Deployment and operational notes

Set `DATABASE_URL`, a strong `JWT_SECRET`, an explicit `CORS_ORIGIN`, and `COOKIE_SECURE=true` in production. Use HTTPS, a managed PostgreSQL service, durable private file storage, backups and a tested restore procedure. Keep upload storage private and retain SDS file hashes for integrity checks. Do not apply migrations to production without reviewing the diff and confirming a restorable backup.
