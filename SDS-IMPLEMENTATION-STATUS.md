# SDS lifecycle completion

Implemented in this cycle:

- Authenticated, organization-scoped SDS history, download, upload, and deletion endpoints.
- SDS version records with file metadata, SHA-256, revision date, uploader, and audit events.
- PDF, PNG, JPG/JPEG, DOCX, and XLSX extension/signature validation with a 10 MiB limit.
- CSRF-aware API client with token initialization, retry, and session-expiration handling.
- Readiness/liveness and Docker hardening retained.

Not verified here: npm installation, PostgreSQL integration, Docker build/start, and browser UI execution. The compact frontend API client exposes SDS methods, but the current `server/public/index.html` still lacks complete SDS/user-management screens and the original specialized laboratory workflows. Therefore this commit cannot be considered production-ready without executing the requested verification suite.
