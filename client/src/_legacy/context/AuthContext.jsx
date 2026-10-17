// context/AuthContext.jsx
// ── Auth state provider ───────────────────────────────────────────────────────
//
// Holds: token (raw JWT string) + user (decoded payload)
//
// Token is persisted in localStorage via api/client.js helpers so it survives
// page refreshes.  The context only owns the in-memory copy and the
// login/logout helpers.  Components that need the token for SSE (EventSource)
// can grab it via useAuth().token.

import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { saveToken, clearToken, TOKEN_KEY } from '../api/client';

// ── JWT decode (no library needed for MVP — JWTs are base64url) ──────────────
function decodeJWT(token) {
  try {
    const payload = token.split('.')[1];
    // atob can't handle base64url directly on all browsers — replace chars first
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(json);
  } catch {
    return null;
  }
}

// ── Context ───────────────────────────────────────────────────────────────────
const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY));
  const [user,  setUser]  = useState(() => {
    const stored = localStorage.getItem(TOKEN_KEY);
    return stored ? decodeJWT(stored) : null;
  });

  // Keep user in sync if token changes externally (e.g. tab sync)
  useEffect(() => {
    function onStorage(e) {
      if (e.key === TOKEN_KEY) {
        const t = e.newValue;
        setToken(t);
        setUser(t ? decodeJWT(t) : null);
      }
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const login = useCallback((newToken) => {
    saveToken(newToken);
    setToken(newToken);
    setUser(decodeJWT(newToken));
  }, []);

  const logout = useCallback(() => {
    clearToken();
    setToken(null);
    setUser(null);
  }, []);

  const isAdmin = user?.role === 'admin';

  return (
    <AuthContext.Provider value={{ token, user, isAdmin, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be inside <AuthProvider>');
  return ctx;
}
