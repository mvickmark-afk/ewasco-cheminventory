# EWASCO v2 backend and frontend

The deployable application is `server/public/index.html`. It uses the secure API and does not store credentials or business records in browser localStorage. Start it with:

```bash
cd server
cp .env.example .env
npm install
npm run migrate
npm run seed-admin
npm start
```

Open `http://localhost:3000/`. The original root `Index.html` is retained as the legacy prototype; the server-served frontend is the migrated API-backed application.
