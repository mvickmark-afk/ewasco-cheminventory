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
