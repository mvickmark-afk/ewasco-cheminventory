/*
 * Canonical frontend API integration layer.
 *
 * API base URL: same-origin /api by default. A deployment may set
 * window.EWASCO_API_BASE before this file loads to target a separately hosted
 * Express API. Credentials are always included so the HttpOnly session cookie
 * is sent with requests; tokens are never stored in browser storage.
 *
 * Authentication flow:
 *   1. csrf() obtains the CSRF token and sets the CSRF cookie server-side.
 *   2. login(username, password) posts credentials and receives the session cookie.
 *   3. me() retrieves the authenticated user from the session.
 *   4. logout() revokes the server-side session and clears the cookie.
 *
 * Every state-changing request includes X-CSRF-Token. A rejected token causes
 * one token refresh and request retry. HTTP errors are converted to Error
 * objects with status/details so callers can show a failure without changing
 * local application state.
 */
(() => {
  'use strict';

  const API = window.EWASCO_API_BASE || '/api';
  let csrfToken = '';

  async function parseResponse(response) {
    const contentType = response.headers.get('content-type') || '';
    const body = contentType.includes('application/json')
      ? await response.json()
      : await response.text();

    if (!response.ok) {
      const error = new Error(body?.error || body?.message || `Request failed (${response.status})`);
      error.status = response.status;
      error.details = body;
      throw error;
    }
    return body;
  }

  async function csrf() {
    const response = await fetch(`${API}/auth/csrf`, { credentials: 'include' });
    const body = await parseResponse(response);
    csrfToken = body.token;
    return csrfToken;
  }

  async function request(path, options = {}, retry = true) {
    const method = (options.method || 'GET').toUpperCase();
    const headers = { ...(options.headers || {}) };

    if (method !== 'GET' && method !== 'HEAD') {
      if (!csrfToken) await csrf();
      headers['X-CSRF-Token'] = csrfToken;
    }

    const response = await fetch(`${API}${path}`, {
      ...options,
      method,
      credentials: 'include',
      headers
    });

    if (response.status === 403 && method !== 'GET' && retry) {
      csrfToken = '';
      await csrf();
      return request(path, options, false);
    }

    if (response.status === 401) {
      window.dispatchEvent(new CustomEvent('ewasco:session-expired'));
    }
    return parseResponse(response);
  }

  function json(method, path, value) {
    return request(path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(value)
    });
  }

  const recordPath = entity => `/records/${encodeURIComponent(entity)}`;

  window.EWASCO_API = {
    baseUrl: API,
    csrf,
    request,
    login: (username, password) => json('POST', '/auth/login', { username, password }),
    me: () => request('/auth/me'),
    logout: () => json('POST', '/auth/logout', {}),
    list: entity => request(recordPath(entity)),
    create: (entity, data) => json('POST', recordPath(entity), data),
    update: (entity, id, data) => json('PUT', `${recordPath(entity)}/${encodeURIComponent(id)}`, data),
    remove: (entity, id) => request(`${recordPath(entity)}/${encodeURIComponent(id)}`, { method: 'DELETE' })
  };

  window.addEventListener('ewasco:session-expired', () => {
    const login = document.getElementById('login');
    const app = document.getElementById('app');
    if (login && app) {
      login.classList.remove('hidden');
      app.classList.add('hidden');
    }
  });
})();
