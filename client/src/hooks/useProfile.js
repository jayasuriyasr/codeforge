import { useSyncExternalStore } from 'react';
import { getProfile, subscribe } from '../lib/profile.js';

// Re-renders whenever the local profile changes (this tab or another).
export function useProfile() {
  return useSyncExternalStore(subscribe, getProfile, getProfile);
}
