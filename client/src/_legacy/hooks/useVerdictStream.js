// useVerdictStream.js
// ── React hook: subscribe to a submission's verdict SSE stream ─────────────────
//
// Contract:
//   • Opens an EventSource to GET /api/v1/submissions/:id/stream.
//   • Parses incoming { type, verdict, runtimeMs, status } frames.
//   • Deduplicates on submissionId — if the same event is re-delivered (e.g. network
//     reconnect replay), it is silently dropped.
//   • Closes the EventSource immediately on a terminal verdict (COMPLETED / FAILED),
//     not waiting for the server's 60-second ceiling.
//   • Exposes { verdict, runtimeMs, status, error, isStreaming } to callers.
//
// Usage:
//   const { verdict, status, isStreaming } = useVerdictStream(submissionId, token);
//
// Design note — EventSource and auth tokens:
//   The browser's native EventSource API does not support custom headers, which
//   makes it impossible to pass an Authorization: Bearer token.  Three options:
//     1. Cookies (session-based auth) — transparent to EventSource.
//     2. Token in query string — works but exposes token in server logs / URL bar.
//     3. Dedicated short-lived ticket endpoint — cleanest but extra round-trip.
//   For this MVP we use option 2 (query param) because the server already validates
//   JWTs in the same middleware layer and the token is already short-lived.
//   Before production: swap to option 3.

import { useState, useEffect, useRef } from 'react';

// Terminal statuses after which we stop listening.
//  DONE  — a verdict was produced      ERROR — an infra fault
const TERMINAL_STATUSES = new Set(['DONE', 'ERROR']);

/**
 * @param {string|null} submissionId  MongoDB _id of the submission to watch.
 *                                     Pass null to disable the hook.
 * @param {string|null} token         JWT bearer token for auth (sent as ?token=).
 * @returns {{
 *   verdict:    string|null,
 *   runtimeMs:  number|null,
 *   status:     string|null,
 *   error:      string|null,
 *   isStreaming: boolean,
 * }}
 */
export function useVerdictStream(submissionId, token) {
  const [verdict,    setVerdict]    = useState(null);
  const [runtimeMs,  setRuntimeMs]  = useState(null);
  const [memoryMB,   setMemoryMB]   = useState(null);
  const [status,     setStatus]     = useState(null);
  const [error,      setError]      = useState(null);
  const [failedTestCase, setFailedTestCase] = useState(null);
  const [isStreaming, setIsStreaming] = useState(false);

  // Tracks submissionIds whose event has already been processed.
  // useRef so the set survives re-renders without triggering them.
  const seenIds = useRef(new Set());

  useEffect(() => {
    // Nothing to subscribe to.
    if (!submissionId || !token) return;

    // Build the SSE URL with the JWT in the query string.
    const baseUrl = import.meta.env.VITE_API_URL || 'http://localhost:5000';
    const url = `${baseUrl}/api/v1/submissions/${encodeURIComponent(submissionId)}/stream?token=${encodeURIComponent(token)}`;

    const es = new EventSource(url);
    setIsStreaming(true);

    function close(reason) {
      es.close();
      setIsStreaming(false);
      console.debug(`[useVerdictStream] closed (${reason}) for`, submissionId);
    }

    es.onmessage = (event) => {
      let payload;
      try {
        payload = JSON.parse(event.data);
      } catch {
        return; // malformed frame — ignore
      }

      const {
        type, submissionId: sid, verdict: v, runtimeMs: ms, memoryMB: mem,
        status: st, message, error: errDetail, failedTestCase: ftc,
      } = payload;

      // ── Deduplication guard ───────────────────────────────────────────────
      // A re-delivered verdict event (e.g. after a brief network hiccup triggers
      // EventSource reconnect) must not be processed twice.
      if (type === 'verdict' && sid) {
        const dedupeKey = `${sid}:${v}`;
        if (seenIds.current.has(dedupeKey)) {
          console.debug('[useVerdictStream] duplicate event dropped:', dedupeKey);
          return;
        }
        seenIds.current.add(dedupeKey);
      }

      if (type === 'verdict') {
        setVerdict(v ?? null);
        setRuntimeMs(ms ?? null);
        setStatus(st);
        if (mem != null) setMemoryMB(mem);
        if (ftc) setFailedTestCase(ftc);
        if (st === 'ERROR') setError(errDetail || 'judging failed (infrastructure error)');

        // Close as soon as a terminal state arrives — don't wait out the ceiling.
        if (TERMINAL_STATUSES.has(st)) {
          close('terminal-verdict');
        }
      } else if (type === 'timeout') {
        setError(message ?? 'stream timed out');
        close('server-timeout');
      } else if (type === 'error') {
        setError(message ?? 'stream error');
        close('server-error');
      }
    };

    es.onerror = (e) => {
      // EventSource reconnects automatically on transient errors; only log here.
      // If the server ended the stream intentionally (terminal verdict / timeout),
      // the `close()` call above already closed `es`, so this handler won't fire.
      console.warn('[useVerdictStream] EventSource error:', e);
    };

    // ── Cleanup: close on unmount or when submissionId/token changes ─────
    return () => close('unmount');
  }, [submissionId, token]); // eslint-disable-line react-hooks/exhaustive-deps

  return { verdict, runtimeMs, memoryMB, status, error, isStreaming, failedTestCase };
}
