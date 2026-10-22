# Engineering traceability and audit controls

## Source of truth

- Production UI: `server/public/index.html`, `server/public/app.js`, `server/public/api-client.js`, and `server/public/validators.js`.
- API and domain logic: `server/src/`.
- Database schema and migrations: `server/sql/` and `server/src/migrate.js`.
- Root-level `Index.html` is a legacy/demo artifact; it is not the deployed API-backed frontend unless deployment configuration explicitly changes.

## Change-control workflow

1. Make changes on a named feature/fix branch; do not commit directly to `main` for application changes.
2. Keep each pull request focused on one defect or a tightly related control improvement.
3. Every defect fix should include a reproducible test or an explicit explanation of why an automated test is not feasible.
4. Run the build verification, unit tests, database-backed integration tests where applicable, and a deployment smoke test before closure.
5. Record the issue, affected paths, root cause, test evidence, deployment commit, and rollback path in the pull request.
6. Treat production deployment success, readiness, and user-visible verification as separate checks. A green deployment alone does not prove a browser is serving the expected assets.

## Runtime traceability

- API and health requests receive a server-generated `X-Request-Id`.
- Structured `http_request` logs include correlation ID, method, route template where available, HTTP status, and duration.
- Error responses include the same request ID; the browser displays it as a reference ID so an operator can correlate a reported failure with server logs.
- Do not log request bodies, passwords, cookies, session tokens, authorization headers, uploaded document content, or query-string values.
- Correlation IDs support troubleshooting; they are not authentication credentials and must not be used as authorization decisions.

## Audit-trail boundaries

Application audit records and operational request logs serve different purposes. Business actions (create/update/delete, review, approval, SDS file version changes, user/security events) belong in the database audit trail with actor, organization, action, entity, record, timestamp, and non-sensitive change metadata. Request logs describe execution and performance; they must not substitute for business audit records.

For regulated use, database permissions and controls should prevent application roles from rewriting or deleting historical audit entries; define retention, backup, access review, and restoration verification. Do not describe the audit trail as tamper-proof until those controls are implemented and tested.

## Frontend asset/cache discipline

When production frontend files change, bump the same query-string version on all three script tags in `server/public/index.html`. The build verifier enforces matching versions and required validator contracts. After deployment, verify the served HTML and script responses, inspect the reported build/commit, and test the affected workflow in a fresh browser session.
