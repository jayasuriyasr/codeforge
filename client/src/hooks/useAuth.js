import { useSyncExternalStore } from 'react';
import { getAuth, subscribeAuth } from '../lib/auth.js';

// { ready, user, profile, isAdmin } — re-renders on sign-in / sign-out.
export function useAuth() {
  const s = useSyncExternalStore(subscribeAuth, getAuth, getAuth);
  return { ...s, isAdmin: s.profile?.role === 'admin' };
}
