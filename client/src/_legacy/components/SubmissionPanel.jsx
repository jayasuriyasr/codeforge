import React, { useState, useEffect } from 'react';
import { useVerdictStream } from '../hooks/useVerdictStream';
import { authFetch, TOKEN_KEY } from '../api/client';
import './SubmissionPanel.css';

const TERMINAL = new Set(['DONE', 'ERROR']);

const VERDICT_CLASS = {
  AC: 'cf-chip--ac', WA: 'cf-chip--wa', TLE: 'cf-chip--tle',
  MLE: 'cf-chip--mle', RE: 'cf-chip--re', CE: 'cf-chip--ce',
};

const PROGRESS_LABEL = { QUEUED: 'Queued…', COMPILING: 'Compiling…', RUNNING: 'Running test cases…' };

/**
 * Live verdict for one submission.
 * @param {string} submissionId
 * @param {(tc:{input,expectedOutput})=>void} [onUseFailingCase]
 */
export default function SubmissionPanel({ submissionId, onUseFailingCase }) {
  const token = localStorage.getItem(TOKEN_KEY);
  const stream = useVerdictStream(submissionId, token);
  const [full, setFull] = useState(null);

  useEffect(() => { setFull(null); }, [submissionId]);

  const isTerminal = TERMINAL.has(stream.status);

  // Pull the persisted submission once it's terminal — it has testResults,
  // compileError, provisional and the (already server-shaped) failedTestCase.
  useEffect(() => {
    if (!submissionId || !isTerminal || full) return;
    let alive = true;
    authFetch(`/api/v1/submissions/${submissionId}`).then((res) => {
      if (alive && res.ok) setFull(res.data);
    });
    return () => { alive = false; };
  }, [submissionId, isTerminal, full]);

  if (!submissionId) return null;

  const verdict = full?.verdict ?? stream.verdict;
  const runtimeMs = full?.runtimeMs ?? stream.runtimeMs;
  const memoryMB = full?.memoryMB ?? stream.memoryMB;
  const provisional = full?.provisional ?? stream.provisional;
  const errorMsg = full?.error ?? stream.error;
  const failed = full?.failedTestCase ?? stream.failedTestCase;
  const hasFailedIO = failed && (failed.input != null || failed.expectedOutput != null || failed.actualOutput != null);

  let badge;
  if (stream.status === 'ERROR') {
    badge = <span className="cf-chip cf-chip--re">ERROR</span>;
  } else if (verdict) {
    badge = <span className={`cf-chip ${VERDICT_CLASS[verdict] || 'cf-chip--infra'}`}>{verdict}</span>;
  } else {
    badge = <span className="cf-chip cf-chip--infra cf-anim-pulse">{PROGRESS_LABEL[stream.status] || 'Judging…'}</span>;
  }

  return (
    <div className="cf-panel submission-panel cf-anim-fade-up">
      <div className="submission-panel-header">
        <h3 className="submission-title">Submission Result</h3>
        <div className="status-badge">
          {badge}
          {provisional && <span className="cf-chip cf-chip--infra" title="Judged on pretests only; system tests run after the contest">provisional</span>}
          {stream.isStreaming && !isTerminal && (
            <span className="cf-anim-spin" style={{ display: 'inline-block', width: 12, height: 12, borderRadius: '50%', border: '2px solid var(--cf-accent)', borderTopColor: 'transparent' }} />
          )}
        </div>
      </div>

      {stream.status === 'ERROR' && (
        <div className="submission-error">Judging failed (infrastructure). {errorMsg}</div>
      )}

      <div className="submission-stats">
        <div className="stat-box">
          <span className="stat-label">Runtime</span>
          <span className="stat-value">{runtimeMs != null ? `${runtimeMs} ms` : '—'}</span>
        </div>
        <div className="stat-box">
          <span className="stat-label">Memory</span>
          <span className="stat-value">{memoryMB != null ? `${Number(memoryMB).toFixed(1)} MB` : '—'}</span>
        </div>
      </div>

      {full?.compileError && (
        <div className="compile-error-container">
          <h4 className="section-heading">Compile Error</h4>
          <pre className="cf-mono compile-error-text">{full.compileError}</pre>
        </div>
      )}

      {full?.testResults?.length > 0 && (
        <div className="test-cases-container cf-anim-fade-in">
          <h4 className="section-heading">Test Cases</h4>
          <div className="test-cases-grid">
            {full.testResults.map((tc, i) => (
              <div key={i} className="cf-surface test-case-card">
                <div className="test-case-header">
                  <span className="test-case-name">#{(tc.testCaseIndex ?? i) + 1}</span>
                  <span className={`cf-chip ${VERDICT_CLASS[tc.verdict] || 'cf-chip--infra'}`}>{tc.verdict}</span>
                </div>
                <div className="test-case-metrics">
                  <span>{tc.runtimeMs != null ? `${tc.runtimeMs} ms` : '—'}</span>
                  <span>{tc.memoryMB ? `${Number(tc.memoryMB).toFixed(1)} MB` : '—'}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {failed && verdict && verdict !== 'AC' && verdict !== 'CE' && (
        <div className="failed-case-box">
          <div className="failed-case-head">
            <h4 className="section-heading" style={{ margin: 0, color: 'var(--cf-danger)' }}>
              Failed on test #{(failed.index ?? '?') + 1}
            </h4>
            {hasFailedIO && onUseFailingCase && (
              <button className="cf-btn cf-btn-sm" onClick={() => onUseFailingCase(failed)}>+ Use as custom test</button>
            )}
          </div>
          {hasFailedIO ? (
            <div className="failed-case-cols">
              <div><div className="failed-case-label">Input</div><pre>{failed.input}</pre></div>
              <div><div className="failed-case-label">Expected</div><pre>{failed.expectedOutput}</pre></div>
              <div><div className="failed-case-label">Actual</div><pre style={{ color: 'var(--cf-danger)' }}>{failed.actualOutput}</pre></div>
            </div>
          ) : (
            <p className="failed-case-hidden">This is a hidden test case — its data isn't shown during the contest.</p>
          )}
        </div>
      )}
    </div>
  );
}
