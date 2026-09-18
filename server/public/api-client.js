/*
 * API persistence adapter for Index.html.
 *
 * Include this script immediately before the existing application script:
 *   <script src="/api-client.js"></script>
 *
 * It replaces localStorage persistence with the authenticated API while
 * retaining the existing UI state and rendering code.
 */
(() => {
  'use strict';
  const API = '/api';
  const entities = ['chemicals','batches','reagents','consumption','equipment','calibrations','suppliers','procurement','water','waste','sds','settings'];
  const originalFetch = window.fetch.bind(window);

  async function request(path, options = {}) {
    const response = await originalFetch(`${API}${path}`, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      ...options
    });
    if (!response.ok) {
      let message = `Request failed (${response.status})`;
      try { message = (await response.json()).error || message; } catch {}
      throw new Error(message);
    }
    if (response.status === 204) return null;
    return response.json();
  }

  window.EWASCO_API = Object.freeze({
    login: (username, password) => request('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }),
    logout: () => request('/auth/logout', { method: 'POST' }),
    me: () => request('/auth/me'),
    list: entity => request(`/records/${encodeURIComponent(entity)}`),
    create: (entity, record) => request(`/records/${encodeURIComponent(entity)}`, { method: 'POST', body: JSON.stringify(record) }),
    update: (entity, id, record, version = 0) => request(`/records/${encodeURIComponent(entity)}/${encodeURIComponent(id)}`, { method: 'PUT', headers: version ? { 'If-Match': String(version) } : {}, body: JSON.stringify(record) }),
    remove: (entity, id) => request(`/records/${encodeURIComponent(entity)}/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    backup: () => request('/backup')
  });

  // A drop-in replacement for the old localStorage-backed save/load functions.
  // The existing application can call these explicitly while it is migrated.
  window.EWASCO_API.loadState = async () => {
    const state = {};
    await Promise.all(entities.map(async entity => { state[entity] = await window.EWASCO_API.list(entity); }));
    return state;
  };
  window.EWASCO_API.saveRecord = async (entity, record) => {
    if (!entities.includes(entity)) throw new Error(`Unsupported entity: ${entity}`);
    return record._version
      ? window.EWASCO_API.update(entity, record.id, record, record._version)
      : window.EWASCO_API.create(entity, record);
  };

  window.addEventListener('ewasco:api-error', event => {
    const message = event.detail?.message || 'The server could not save your changes.';
    if (typeof window.toast === 'function') window.toast(message);
  });
})();
