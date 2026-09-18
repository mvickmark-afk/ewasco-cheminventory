# Production hardening and remaining integration

The backend now includes database-backed session revocation, CSRF protection, role enforcement, transaction-backed mutations and audit entries, user-management endpoints, SDS uploads, validation tests, and Docker deployment files.

Run locally:

```bash
cd server
cp .env.example .env
npm install
npm run migrate
npm run seed-admin
npm test
npm start
```

Or with Docker:

```bash
docker compose up --build
```

The server-served frontend remains a compact API-backed CRUD screen. The legacy root `Index.html` has specialized views that should be migrated screen-by-screen to avoid losing domain behavior; do not expose it as the production entry point until its writes use the API. For production, use HTTPS, set `COOKIE_SECURE=true`, use a managed PostgreSQL instance, rotate `JWT_SECRET`, replace default Docker credentials, and configure a durable private object store for SDS files.
