# Server setup

This backend replaces the demo authentication and `localStorage` persistence with PostgreSQL-backed, multi-user storage.

## Run locally

```bash
cd server
cp .env.example .env
npm install
npm run migrate
npm run seed-admin
npm start
```

Serve the existing `Index.html` from the same origin (or set `CORS_ORIGIN` for a separate frontend). The API is available under `/api`.

The seed command reads `ADMIN_USERNAME`, `ADMIN_PASSWORD`, and `ORG_NAME`; it never stores the password in source control. Change the generated password immediately in a real deployment.

## API

- `POST /api/auth/login` — creates an HttpOnly session cookie
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `GET /api/records/:entity`
- `POST /api/records/:entity`
- `PUT /api/records/:entity/:id`
- `DELETE /api/records/:entity/:id`
- `GET /api/backup` — authenticated organization backup

Supported entity names are `chemicals`, `batches`, `reagents`, `consumption`, `equipment`, `calibrations`, `suppliers`, `procurement`, `water`, `waste`, `sds`, and `settings`.

The API scopes every query by the authenticated user's organization, validates record IDs, limits payload size, and writes an audit event for every mutation. Passwords are bcrypt hashes and sessions are signed, expiring HttpOnly cookies.
