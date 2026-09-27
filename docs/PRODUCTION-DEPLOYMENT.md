# Production deployment

This application runs as a Node.js API with PostgreSQL and persistent private file storage.

## Required production configuration

Set these through the deployment platform's secret/environment manager. Never commit real values.

- NODE_ENV=production
- DATABASE_URL
- JWT_SECRET: random, unique, at least 32 characters
- CORS_ORIGIN: exact HTTPS browser origin
- COOKIE_SECURE=true
- UPLOAD_DIR: persistent private storage mount

The server refuses production startup when JWT_SECRET is unsafe, CORS_ORIGIN is missing/wildcard, or COOKIE_SECURE is not true.

## Database

Run the migration before accepting traffic. The migration is transactional and idempotent for the current schema. Back up the database before upgrades and verify the required tables after migration.

For disaster recovery, use PostgreSQL native backups/PITR. The application JSON backup is an organisation portability/recovery mechanism, not a replacement for database-level disaster recovery.

## File storage

SDS files are stored outside PostgreSQL. The upload directory must be persistent private storage and included in the backup/restore policy. Do not expose it as a public static directory.

## Reverse proxy

Terminate TLS at the load balancer/reverse proxy and forward traffic to port 3000. Restrict direct inbound access to the application port.

## Health checks

- GET /healthz — process health
- GET /readyz — process plus PostgreSQL readiness

Use /readyz for traffic readiness.

## Release procedure

1. Create a PostgreSQL backup/PITR checkpoint.
2. Deploy the new image.
3. Run the migration.
4. Verify /readyz.
5. Verify login, CSRF, inventory receive/issue, SDS upload/download and organisation isolation.
6. Monitor logs and database health.
7. Keep the previous image available for rollback.

## Recovery drill

Before production use, restore a PostgreSQL backup into an isolated database and restore private SDS storage into an isolated location. Verify login, inventory balances, audit history and SDS downloads.
