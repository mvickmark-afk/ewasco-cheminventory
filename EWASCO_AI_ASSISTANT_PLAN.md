# EWASCO AI Assistant — Implementation Plan

Status: design and repository baseline only. No AI code has been deployed, no production configuration has been changed, and no production data has been modified.

## Objective

Add a document-grounded assistant to the existing EWASCO Chemical Inventory application, then expose a small set of authorised, auditable read and write actions through the existing backend. Preserve the current PostgreSQL database, user accounts, sessions, uploaded SDS files, and production deployment.

## Repository baseline observed

- Repository: `mvickmark-afk/ewasco-cheminventory`
- Base branch: `main`
- Backend: Node.js ES modules, Express, PostgreSQL (`pg`), Zod validation.
- Authentication: session cookie, JWT verification, CSRF protection, and database-backed sessions.
- Authorisation: role definitions in `server/src/permissions.js`.
- Existing records are scoped by `organization_id`; the `records` table stores entities including chemicals, batches, reagents, consumption, SDS records and settings.
- Audit events are written to `audit_log`.
- SDS file binaries are stored on disk in the configured upload directory; file metadata and versions are stored in PostgreSQL.
- Existing backend test command: `cd server && npm test`; it runs build-contract checks and Node tests.
- Railway production currently reports the application and PostgreSQL services as online. This is not proof of successful login or correct AI behaviour.

## Initial provider decision

Use the OpenAI API behind a server-side provider adapter for the first implementation. The existing backend is JavaScript/Node.js, and OpenAI's Responses API offers a managed file-search tool that can reduce the amount of retrieval infrastructure required for an initial version. This is a pragmatic integration decision, not a claim that OpenAI is universally better than Claude.

Keep provider/model identifiers in environment configuration, not hard-coded business logic. Start with a low-cost model for retrieval-grounded Q&A and benchmark it against a stronger model using EWASCO-specific tests before fixing the production default. Verify model availability and current pricing in the actual API account before enabling paid traffic. Hosted file-search storage and calls incur additional charges; set a budget and usage alerts.

Official references:
- https://developers.openai.com/api/docs/guides/tools-file-search
- https://developers.openai.com/api/docs/guides/tools
- https://platform.openai.com/pricing
- https://platform.claude.com/docs/en/about-claude/pricing

## Release plan

### R0 — Baseline and safety (current)

1. Inspect current branch, app entry points, schema, roles, tests, deployment status and SDS storage.
2. Create an isolated feature branch from `main`.
3. Do not change production environment variables, secrets, database rows, volumes or deployment source.
4. Establish local tests and a safe test strategy before application changes.

Exit criteria: code paths and access-control rules relevant to AI are identified; existing test baseline is recorded; no production mutation has occurred.

### R1 — Read-only knowledge Q&A

1. Add an AI service module and server-only provider configuration.
2. Add a dedicated assistant endpoint protected by the existing authentication middleware and rate limits.
3. Require authenticated users and enforce organisation boundaries before retrieval. Do not put confidential payroll, personnel, or other unrelated records into the knowledge store.
4. Ingest only approved documents with metadata: organisation, document ID, title, revision/version, effective date, document type, approval status and access classification.
5. Return concise answers with source citations. If approved evidence is missing or conflicting, say so rather than guessing.
6. Treat document text and user uploads as untrusted content; instructions embedded in documents must not override application policy.
7. Keep AI request/response content out of general logs by default. Log request IDs, model/version, duration, usage, source IDs and error classes; apply retention limits.

Exit criteria: tests cover supported answers, missing evidence, conflicting revisions, organisation isolation, unauthenticated access, rate limits and prompt-injection examples.

### R2 — Controlled tool calling

Start with read-only tools:
- `search_chemical_inventory`
- `get_batch_expiry`
- `get_sds_metadata`

For every tool, derive the user and organisation from the authenticated server session, never from model-supplied arguments. Validate inputs with Zod and reuse existing permission checks and business logic.

Only after read-only tools pass tests, add draft workflows. Any consequential write (chemical issue, adjustment, disposal, approval) must use a validated backend transaction, explicit role permission, an idempotency strategy, and a confirmation step. The model must not write directly to PostgreSQL or invent transaction IDs. Tool output must reflect the actual committed result.

Exit criteria: deny-by-default permission tests, cross-organisation tests, duplicate/replay tests, audit-log assertions and confirmation-flow tests pass.

### R3 — Evaluation, observability and release gates

- Version prompts and model configuration.
- Maintain a version-controlled evaluation set drawn from approved EWASCO procedures, SDSs and inventory scenarios.
- Test retrieval relevance, citation correctness, abstention, role permissions, prompt injection, tool selection, factual accuracy and regression.
- Require passing CI checks and review before merge.
- Track token use, file-search calls/storage, latency, errors and per-user/org rate limits.
- Add caching only for responses safe to share under identical organisation, permission and document-version scope.
- Deploy to a non-production environment first; verify login and existing core workflows before any production release.

## Security invariants

- Never expose API keys in browser code, repository files, logs or chat output.
- Never run schema migrations or seed/reset utilities against production as part of AI setup.
- Never give the model raw database credentials or unrestricted SQL access.
- Never trust a role, user ID, organisation ID, or permission asserted by the model or client.
- Do not index all production records or SDS files by default. Only approved, access-classified documents may be indexed.
- Keep the existing application and database authoritative for stock quantities, permissions, and transaction state.
- Any production release requires an explicit reviewed deployment step and a verified rollback plan.

## Cost and model selection

Do not optimise by model price alone. Measure cost per correctly answered question and per successfully completed workflow. Compare a lower-cost model with a stronger candidate on the same evaluation set. Include input/output tokens, retrieval calls, storage, retries and failed requests. Apply per-user and global usage limits, and configure provider billing alerts before inviting broad use.

## Immediate next tasks

1. Complete the read-only repository inspection, including current branch/commit, relevant tests and exact frontend/backend structure.
2. Record the current test baseline without connecting to production credentials.
3. Add a small AI configuration/service layer and tests on this feature branch only.
4. Review the diff and checks before opening a pull request. No automatic production deployment.
