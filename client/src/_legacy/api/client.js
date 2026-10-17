// api/client.js
// ── Thin HTTP client for CodeForge Arena ──────────────────────────────────────
//
// Two entry points:
//   apiFetch(path, opts)      — unauthenticated (register, login)
//   authFetch(path, opts)     — reads JWT from localStorage and injects
//                               Authorization: Bearer <token>
//
// Both return { ok, status, data } where data is the parsed JSON body.
// A non-2xx response still resolves (callers inspect .ok), only network
// failures throw.

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:5000';

export const TOKEN_KEY = 'cf_jwt'; // localStorage key

// ── helpers ──────────────────────────────────────────────────────────────────

function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function saveToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

async function request(path, opts = {}, auth = false) {
  const headers = { 'Content-Type': 'application/json', ...opts.headers };

  if (auth) {
    const token = getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${BASE}${path}`, { ...opts, headers });

  let data = null;
  try {
    data = await res.json();
  } catch {
    // some endpoints return 204 No Content
  }

  return { ok: res.ok, status: res.status, data };
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Un-authenticated request — register, login, public problem list */
export function apiFetch(path, opts = {}) {
  return request(path, opts, false);
}

/** Authenticated request — attaches the stored JWT automatically */
export function authFetch(path, opts = {}) {
  return request(path, opts, true);
}
