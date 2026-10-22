# Request correlation and audit traceability

## Goals

The service must let an operator connect a user-visible error, a server log entry, and the corresponding audit event without recording secrets or relying on approximate timestamps.

## Request lifecycle

1. The server generates a UUID for every incoming request. Client-supplied IDs are not trusted as the canonical identifier.
2. The response includes `X-Request-ID`; the same ID is held in request-scoped `AsyncLocalStorage`.
3. API request logs are single-line JSON objects with `event=http_request`, `requestId`, HTTP method, route, status and duration.
4. Server errors are logged as `event=api_error` with the same `requestId`. The response returns a generic message and a request reference rather than exposing internal exception details.
5. The shared audit writer stores `request_id` alongside organization, actor, action, entity, record ID, data and timestamp. The audit screen/API can therefore be joined to operational logs using this field.

## Investigation workflow

- Ask the operator for the exact error reference shown in the application.
- Search service logs for that `requestId`.
- Inspect the matching `audit_log` row using the same `request_id` and organization scope.
- Compare the route, status, duration, action and entity. Check SDS version and SHA-256 metadata where the event concerns a document.
- Record the diagnosis and corrective change in the issue or pull request; add a regression test before merging.

## Security and data minimisation

Never log credentials, bearer/session tokens, CSRF tokens, document bytes, full request bodies or extracted SDS text. Keep logs structured and machine searchable. User-facing errors should not expose SQL errors, filesystem paths or stack traces. Correlation IDs are identifiers, not authentication credentials.

## Known backup limitation

The current `/api/backup` endpoint exports legacy `records` rows only. It is not a complete LIMS/QMS disaster-recovery backup and does not package SDS file bytes. Do not treat this export as the sole production backup. Full export/restore across structured LIMS tables, controlled documents and SDS file storage must be designed and tested as a separate change.

## Schema evolution

`audit_log.request_id` is nullable to preserve historical rows. The migration uses `ADD COLUMN IF NOT EXISTS`, and a partial index supports lookup of correlated events without indexing legacy null values. New audit-writing code should use the shared helper rather than issuing direct inserts so request context is not lost. New schema fields must be reflected in migration verification and tests.
