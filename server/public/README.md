# Frontend API integration

The existing root `Index.html` remains the original UI. To move it from browser-only storage to the backend, serve it through the Node server and add this tag immediately before its current inline application script:

```html
<script src="/api-client.js"></script>
<script>
  // The application script should use the adapter as follows:
  // login(): await EWASCO_API.login(username, password)
  // sessionBoot(): const { user } = await EWASCO_API.me()
  // logout(): await EWASCO_API.logout()
  // load(): Object.assign(state, await EWASCO_API.loadState())
  // saveChemical(id): await EWASCO_API.saveRecord('chemicals', record)
  // and equivalent calls for the other supported entities.
</script>
```

Do not keep passwords or session tokens in `localStorage`. The server uses an HttpOnly cookie. The API also returns `_version`; pass this value on updates to detect concurrent edits rather than silently overwriting another user's changes.

Because the GitHub file is a compact single-file application, the inline functions need to be changed at their mutation points rather than replacing all localStorage calls blindly. The adapter provides the complete authenticated API surface for that migration.


## Production source of truth

The deployed UI is **only**:
- `server/public/index.html`
- `server/public/app.js`
- `server/public/api-client.js`

The former root browser-only application is archived at `legacy/Index.html`. Do not make production changes there.

Production backend changes belong under `server/src/`, with new feature logic isolated in dedicated modules where practical. Avoid inserting large feature blocks directly into `server/src/server.js`.
