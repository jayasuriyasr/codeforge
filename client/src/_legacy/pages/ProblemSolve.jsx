// pages/ProblemSolve.jsx
// ── Problem solver UI ────────────────────────────────────────────────────────
//
// Left pane: problem statement / your submissions / custom test cases.
// Right pane: Monaco editor + Run Samples (in-browser) vs Submit (server judge).
// When opened with ?contestId=..., submissions are tagged for that contest.

import { useState, useEffect } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import Editor from '@monaco-editor/react';
import { authFetch } from '../api/client';
import { runSample, judgePractice, supportsClientJudge, warmup } from '../judge';
import SubmissionPanel from '../components/SubmissionPanel';
import { useAuth } from '../context/AuthContext';

const VERDICT_CHIP = {
  AC: 'cf-chip--ac', WA: 'cf-chip--wa', TLE: 'cf-chip--tle',
  MLE: 'cf-chip--mle', RE: 'cf-chip--re', CE: 'cf-chip--ce',
};

// Per-user local record of practice problems judged AC in this browser.
// Client-attested (practice has no stakes) — see the v4 trust model.
const solvedKey = (uid) => `cf_practice_solved_${uid}`;
function markPracticeSolved(uid, problemId) {
  try {
    const s = new Set(JSON.parse(localStorage.getItem(solvedKey(uid)) || '[]'));
    s.add(problemId);
    localStorage.setItem(solvedKey(uid), JSON.stringify([...s]));
  } catch { /* storage unavailable */ }
}

// ── Boilerplate code for each language ────────────────────────────────────────

const DEFAULT_CODE = {
  javascript: "",
  python: "",
  cpp: "",
  java: ""
};

const LANGUAGES = [
  { id: 'javascript', label: 'JavaScript (Node.js)' },
  { id: 'python',     label: 'Python 3' },
  { id: 'cpp',        label: 'C++' },
  { id: 'java',       label: 'Java' },
];

export default function ProblemSolvePage() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const contestId = searchParams.get('contestId') || null;
  const { user, logout } = useAuth();

  // Problem state
  const [problem, setProblem] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');

  // Left pane tab state
  const [leftTab, setLeftTab] = useState('description');
  const [pastSubmissions, setPastSubmissions] = useState([]);
  const [loadingSubmissions, setLoadingSubmissions] = useState(false);
  
  const [localTestCases, setLocalTestCases] = useState(() => {
    try {
      const saved = localStorage.getItem(`cf_local_tc_${user?.sub}_${id}`);
      return saved ? JSON.parse(saved) : null;
    } catch { return null; }
  });

  useEffect(() => {
    if (problem && localTestCases === null) {
      const sampleTests = (problem.testCases || []).filter(tc => tc.isSample).map(tc => ({
        input: tc.input,
        expectedOutput: tc.expectedOutput || ''
      }));
      setLocalTestCases(sampleTests);
    }
  }, [problem, localTestCases]);

  useEffect(() => {
    if (localTestCases !== null) {
      localStorage.setItem(`cf_local_tc_${user?.sub}_${id}`, JSON.stringify(localTestCases));
    }
  }, [localTestCases, id, user?.sub]);

  useEffect(() => {
    if (leftTab === 'submissions') {
      setLoadingSubmissions(true);
      authFetch(`/api/v1/submissions/problem/${id}`)
        .then(({ ok, data }) => {
          if (ok) setPastSubmissions(data.submissions || []);
        })
        .finally(() => setLoadingSubmissions(false));
    }
  }, [leftTab, id]);

  // Editor state (persisted to localStorage per user and problem)
  const [codes, setCodes] = useState(() => {
    try {
      const saved = localStorage.getItem(`cf_codes_${user?.sub}_${id}`);
      return saved ? { ...DEFAULT_CODE, ...JSON.parse(saved) } : { ...DEFAULT_CODE };
    } catch { return { ...DEFAULT_CODE }; }
  });
  const [language, setLanguage] = useState(() => localStorage.getItem(`cf_lang_${user?.sub}_${id}`) || 'javascript');
  const [code, setCode] = useState(() => codes[localStorage.getItem(`cf_lang_${user?.sub}_${id}`) || 'javascript'] || DEFAULT_CODE['javascript']);

  useEffect(() => {
    localStorage.setItem(`cf_codes_${user?.sub}_${id}`, JSON.stringify(codes));
  }, [codes, id, user?.sub]);

  useEffect(() => {
    localStorage.setItem(`cf_lang_${user?.sub}_${id}`, language);
  }, [language, id, user?.sub]);

  // Runner state
  const [sampleRunning, setSampleRunning] = useState(false);
  const [sampleResults, setSampleResults] = useState([]);
  
  // Submit state
  const [submitting, setSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState('');
  const [liveSubmissionId, setLiveSubmissionId] = useState(null);   // server judge
  const [practiceResult, setPracticeResult] = useState(null);       // in-browser practice judge
  const [practiceProgress, setPracticeProgress] = useState(null);
  const [panelHeight, setPanelHeight] = useState(250);

  const isPractice = problem?.mode !== 'contest' && !contestId;
  const clientJudged = isPractice && supportsClientJudge(language);
  const hasOutput = sampleResults.length > 0 || !!submitResult || !!liveSubmissionId || !!practiceResult;

  function handleDragStart(e) {
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = panelHeight;
    
    function onMouseMove(moveEvent) {
      const deltaY = startY - moveEvent.clientY;
      setPanelHeight(Math.max(100, Math.min(window.innerHeight * 0.8, startHeight + deltaY)));
    }
    
    function onMouseUp() {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    }
    
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }

  // ── Fetch problem on mount ──
  useEffect(() => {
    let cancelled = false;
    authFetch(`/api/v1/problems/${id}`)
      .then(({ ok, data }) => {
        if (cancelled) return;
        if (!ok) { setError(data?.error ?? 'Failed to load problem'); return; }
        setProblem(data.problem);
      })
      .catch(() => { if (!cancelled) setError('Network error'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [id]);

  // ── Handlers ──

  function handleLanguageChange(e) {
    const newLang = e.target.value;
    setCodes(prev => ({ ...prev, [language]: code }));
    setLanguage(newLang);
    setCode(codes[newLang]);
    warmup(newLang);   // start downloading Pyodide if they picked Python
  }

  async function handleRunSamples() {
    if (!problem || localTestCases === null) return;
    setSampleRunning(true);
    setSampleResults([]);
    setSubmitResult('');

    const testsToRun = [...localTestCases];
    if (testsToRun.length === 0 && problem.testCases?.length > 0) testsToRun.push(problem.testCases[0]);
    if (testsToRun.length === 0) { setSampleRunning(false); return; }

    const results = [];
    for (let i = 0; i < testsToRun.length; i++) {
      const tc = testsToRun[i];
      // Non-authoritative — runs in a throwaway Web Worker in this tab.
      const res = await runSample({
        language, code, input: tc.input, expectedOutput: tc.expectedOutput || '',
        checkerType: problem.checkerType, timeLimitSec: problem.timeLimitSec,
        memoryLimitMB: problem.memoryLimitMB,
      });
      results.push({ index: i + 1, input: tc.input, expected: tc.expectedOutput || '', ...res });
    }

    setSampleResults(results);
    setSampleRunning(false);
  }

  async function handleServerSubmit() {
    setSubmitting(true);
    setSubmitResult('');
    setSampleResults([]);
    setPracticeResult(null);
    setLiveSubmissionId(null);
    try {
      const body = { problemId: id, language, code };
      if (contestId) body.contestId = contestId;   // server re-checks eligibility
      const { ok, data } = await authFetch('/api/v1/submissions', {
        method: 'POST',
        headers: { 'Idempotency-Key': `${user.sub}-${id}-${Date.now()}` },
        body: JSON.stringify(body),
      });
      if (!ok) setSubmitResult(`Error: ${data?.error || 'Submission failed'}`);
      else setLiveSubmissionId(data.submission._id);
    } catch {
      setSubmitResult('Network error while submitting.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handlePracticeJudge() {
    setSubmitting(true);
    setSubmitResult('');
    setSampleResults([]);
    setLiveSubmissionId(null);
    setPracticeResult(null);
    setPracticeProgress({ done: 0, total: (problem.testCases || []).length });
    try {
      const res = await judgePractice({
        language, code, problem,
        onProgress: (p) => setPracticeProgress({ done: p.done, total: p.total }),
      });
      setPracticeResult(res);
      if (res.verdict === 'AC') markPracticeSolved(user.sub, id);
    } catch (err) {
      setPracticeResult({ verdict: 'RE', error: String(err.message || err), cases: [] });
    } finally {
      setSubmitting(false);
      setPracticeProgress(null);
    }
  }

  const handleSubmit = clientJudged ? handlePracticeJudge : handleServerSubmit;

  // ── Render ──

  if (loading) {
    return (
      <div style={{ padding: 'var(--cf-space-8)', textAlign: 'center', color: 'var(--cf-text-muted)' }}>
        <div className="cf-anim-spin" style={{ width: 24, height: 24, border: '3px solid var(--cf-border-base)', borderTopColor: 'var(--cf-accent)', borderRadius: '50%', margin: '0 auto var(--cf-space-4)' }} />
        Loading problem...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 'var(--cf-space-8)', color: 'var(--cf-danger)' }}>
        Error: {error}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100dvh', background: 'var(--cf-bg-base)' }}>
      {/* Navbar Minimal */}
      <nav style={{
        height: 'var(--cf-navbar-height)', display: 'flex', alignItems: 'center',
        padding: '0 var(--cf-space-6)', borderBottom: '1px solid var(--cf-border-muted)',
        background: 'var(--cf-bg-raised)', zIndex: 'var(--cf-z-overlay)'
      }}>
        <Link to={contestId ? `/contests/${contestId}` : '/problems'} style={{ textDecoration: 'none', color: 'var(--cf-text-muted)', marginRight: 'var(--cf-space-4)' }}>
          ← Back
        </Link>
        <span style={{ fontWeight: 'var(--cf-weight-bold)', color: 'var(--cf-text-bright)' }}>
          {problem.title}
        </span>
        {contestId && (
          <span className="cf-chip cf-chip--infra" style={{ marginLeft: 'var(--cf-space-3)' }}>
            contest mode — submissions count toward standings
          </span>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 'var(--cf-space-4)' }}>
          <button onClick={logout} style={{ background: 'none', border: 'none', color: 'var(--cf-text-secondary)', cursor: 'pointer', fontFamily: 'var(--cf-font-ui)' }}>Log Out</button>
        </div>
      </nav>

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Left Pane: Problem Statement / Submissions */}
        <div style={{
          flex: 1, display: 'flex', flexDirection: 'column',
          borderRight: '1px solid var(--cf-border-muted)', background: 'var(--cf-bg-base)'
        }}>
          {/* Left Pane Tabs */}
          <div style={{
            display: 'flex', padding: '0 var(--cf-space-6)', gap: 'var(--cf-space-6)',
            borderBottom: '1px solid var(--cf-border-muted)', background: 'var(--cf-bg-raised)'
          }}>
            <button 
              onClick={() => setLeftTab('description')}
              style={{
                background: 'none', border: 'none', borderBottom: leftTab === 'description' ? '2px solid var(--cf-accent)' : '2px solid transparent',
                color: leftTab === 'description' ? 'var(--cf-text-primary)' : 'var(--cf-text-secondary)',
                padding: 'var(--cf-space-4) 0', cursor: 'pointer', fontWeight: 'var(--cf-weight-medium)', fontSize: 'var(--cf-text-md)'
              }}
            >
              Description
            </button>
            <button 
              onClick={() => setLeftTab('submissions')}
              style={{
                background: 'none', border: 'none', borderBottom: leftTab === 'submissions' ? '2px solid var(--cf-accent)' : '2px solid transparent',
                color: leftTab === 'submissions' ? 'var(--cf-text-primary)' : 'var(--cf-text-secondary)',
                padding: 'var(--cf-space-4) 0', cursor: 'pointer', fontWeight: 'var(--cf-weight-medium)', fontSize: 'var(--cf-text-md)'
              }}
            >
              Submissions
            </button>
            <button 
              onClick={() => setLeftTab('testcases')}
              style={{
                background: 'none', border: 'none', borderBottom: leftTab === 'testcases' ? '2px solid var(--cf-accent)' : '2px solid transparent',
                color: leftTab === 'testcases' ? 'var(--cf-text-primary)' : 'var(--cf-text-secondary)',
                padding: 'var(--cf-space-4) 0', cursor: 'pointer', fontWeight: 'var(--cf-weight-medium)', fontSize: 'var(--cf-text-md)'
              }}
            >
              Testcases
            </button>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: 'var(--cf-space-6)' }}>
            {leftTab === 'description' && (
              <>
                <h1 style={{ fontSize: 'var(--cf-text-2xl)', margin: '0 0 var(--cf-space-4)' }}>{problem.title}</h1>
                <div style={{ display: 'flex', gap: 'var(--cf-space-4)', marginBottom: 'var(--cf-space-6)' }}>
                  <span className="cf-chip cf-chip--infra">{problem.difficulty}</span>
                  <span className="cf-chip cf-chip--infra">{problem.timeLimitSec}s</span>
                  <span className="cf-chip cf-chip--infra">{problem.memoryLimitMB}MB</span>
                </div>
                
                <div style={{ fontSize: 'var(--cf-text-md)', lineHeight: 'var(--cf-leading-relaxed)', color: 'var(--cf-text-secondary)' }}>
                  <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', background: 'none', border: 'none', padding: 0 }}>
                    {problem.statement}
                  </pre>
                </div>
              </>
            )}

            {leftTab === 'testcases' && (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--cf-space-4)' }}>
                  <h2 style={{ fontSize: 'var(--cf-text-xl)', margin: 0 }}>Testcases</h2>
                  <button
                    onClick={() => setLocalTestCases([...(localTestCases || []), { input: '', expectedOutput: '' }])}
                    style={{
                      background: 'var(--cf-bg-overlay)', border: '1px solid var(--cf-border-strong)', color: 'var(--cf-text-primary)',
                      padding: 'var(--cf-space-1) var(--cf-space-3)', borderRadius: 'var(--cf-radius-sm)', cursor: 'pointer', fontSize: 'var(--cf-text-sm)'
                    }}
                  >
                    + Add Testcase
                  </button>
                </div>
                {!localTestCases || localTestCases.length === 0 ? (
                  <div style={{ color: 'var(--cf-text-muted)', fontStyle: 'italic', marginBottom: 'var(--cf-space-6)' }}>
                    No testcases added. Click the button above to add one.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--cf-space-4)', marginBottom: 'var(--cf-space-6)' }}>
                    {localTestCases.map((tc, idx) => (
                      <div key={idx} style={{ background: 'var(--cf-bg-raised)', border: '1px solid var(--cf-border-muted)', borderRadius: 'var(--cf-radius-md)', padding: 'var(--cf-space-4)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--cf-space-2)' }}>
                          <span style={{ fontWeight: 'var(--cf-weight-bold)', fontSize: 'var(--cf-text-sm)' }}>Testcase {idx + 1}</span>
                          <button
                            onClick={() => {
                              const newTc = [...localTestCases];
                              newTc.splice(idx, 1);
                              setLocalTestCases(newTc);
                            }}
                            style={{ background: 'none', border: 'none', color: 'var(--cf-danger)', cursor: 'pointer', fontSize: 'var(--cf-text-sm)' }}
                          >
                            Remove
                          </button>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--cf-space-2)' }}>
                          <div>
                            <label style={{ fontSize: 'var(--cf-text-xs)', color: 'var(--cf-text-muted)', display: 'block', marginBottom: 'var(--cf-space-1)' }}>Input</label>
                            <textarea 
                              value={tc.input}
                              onChange={e => {
                                const newTc = [...localTestCases];
                                newTc[idx].input = e.target.value;
                                setLocalTestCases(newTc);
                              }}
                              style={{ width: '100%', height: '80px', background: 'var(--cf-bg-input)', border: '1px solid var(--cf-border-base)', color: 'var(--cf-text-primary)', fontFamily: 'var(--cf-font-mono)', fontSize: 'var(--cf-text-xs)', padding: 'var(--cf-space-2)', borderRadius: 'var(--cf-radius-sm)', resize: 'vertical' }}
                            />
                          </div>
                          <div>
                            <label style={{ fontSize: 'var(--cf-text-xs)', color: 'var(--cf-text-muted)', display: 'block', marginBottom: 'var(--cf-space-1)' }}>Expected Output (Optional)</label>
                            <textarea 
                              value={tc.expectedOutput || ''}
                              onChange={e => {
                                const newTc = [...localTestCases];
                                newTc[idx].expectedOutput = e.target.value;
                                setLocalTestCases(newTc);
                              }}
                              style={{ width: '100%', height: '60px', background: 'var(--cf-bg-input)', border: '1px solid var(--cf-border-base)', color: 'var(--cf-text-primary)', fontFamily: 'var(--cf-font-mono)', fontSize: 'var(--cf-text-xs)', padding: 'var(--cf-space-2)', borderRadius: 'var(--cf-radius-sm)', resize: 'vertical' }}
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}

            {leftTab === 'submissions' && (
              <>
                <h2 style={{ fontSize: 'var(--cf-text-xl)', margin: '0 0 var(--cf-space-4)' }}>Your Submissions</h2>
                {loadingSubmissions ? (
                  <div className="cf-anim-spin" style={{ width: 24, height: 24, border: '3px solid var(--cf-border-base)', borderTopColor: 'var(--cf-accent)', borderRadius: '50%', margin: 'var(--cf-space-4) auto' }} />
                ) : pastSubmissions.length === 0 ? (
                  <div style={{ color: 'var(--cf-text-muted)', fontStyle: 'italic' }}>No submissions yet for this problem.</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--cf-space-3)' }}>
                    {pastSubmissions.map(sub => (
                      <div key={sub._id} style={{
                        padding: 'var(--cf-space-4)',
                        background: 'var(--cf-bg-raised)',
                        border: '1px solid var(--cf-border-muted)',
                        borderRadius: 'var(--cf-radius-md)',
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                      }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--cf-space-2)', width: '100%' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--cf-space-3)' }}>
                            <span className={`cf-chip ${sub.verdict === 'AC' ? 'cf-chip--ac' : (sub.verdict && sub.verdict !== 'AC') ? 'cf-chip--wa' : 'cf-chip--infra'}`}>
                              {sub.verdict || sub.status}
                            </span>
                            <span style={{ fontSize: 'var(--cf-text-sm)', color: 'var(--cf-text-muted)' }}>
                              {new Date(sub.createdAt).toLocaleString()}
                            </span>
                          </div>
                          <div style={{ display: 'flex', gap: 'var(--cf-space-4)', fontSize: 'var(--cf-text-xs)', color: 'var(--cf-text-secondary)' }}>
                            <span>Language: {sub.language}</span>
                            {sub.runtimeMs != null && <span>Time: {sub.runtimeMs}ms</span>}
                            {sub.memoryMB != null && <span>Memory: {sub.memoryMB}MB</span>}
                          </div>
                          {sub.failedTestCase && (
                            <div style={{ marginTop: 'var(--cf-space-2)', background: 'var(--cf-bg-base)', border: '1px solid var(--cf-border-muted)', borderRadius: 'var(--cf-radius-sm)', padding: 'var(--cf-space-2)' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--cf-space-1)' }}>
                                <h6 style={{ margin: 0, color: 'var(--cf-danger)', fontSize: 'var(--cf-text-2xs)' }}>Failed Test Case:</h6>
                                <button
                                  onClick={() => {
                                    setLocalTestCases([...(localTestCases || []), { input: sub.failedTestCase.input, expectedOutput: sub.failedTestCase.expectedOutput }]);
                                    setLeftTab('testcases');
                                  }}
                                  style={{ background: 'none', border: '1px solid var(--cf-border-strong)', color: 'var(--cf-text-secondary)', padding: '2px 8px', borderRadius: 'var(--cf-radius-sm)', cursor: 'pointer', fontSize: 'var(--cf-text-2xs)' }}
                                >
                                  + Use as Custom Testcase
                                </button>
                              </div>
                              <div style={{ display: 'flex', gap: 'var(--cf-space-2)' }}>
                                <div style={{ flex: 1 }}>
                                  <div style={{ fontSize: 'var(--cf-text-2xs)', color: 'var(--cf-text-muted)' }}>Input:</div>
                                  <pre style={{ margin: 0, padding: 0, background: 'none', border: 'none', color: 'var(--cf-text-secondary)', fontSize: 'var(--cf-text-2xs)', maxHeight: '60px', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub.failedTestCase.input}</pre>
                                </div>
                                <div style={{ flex: 1 }}>
                                  <div style={{ fontSize: 'var(--cf-text-2xs)', color: 'var(--cf-text-muted)' }}>Expected:</div>
                                  <pre style={{ margin: 0, padding: 0, background: 'none', border: 'none', color: 'var(--cf-text-secondary)', fontSize: 'var(--cf-text-2xs)', maxHeight: '60px', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub.failedTestCase.expectedOutput}</pre>
                                </div>
                                <div style={{ flex: 1 }}>
                                  <div style={{ fontSize: 'var(--cf-text-2xs)', color: 'var(--cf-text-muted)' }}>Actual:</div>
                                  <pre style={{ margin: 0, padding: 0, background: 'none', border: 'none', color: 'var(--cf-danger)', fontSize: 'var(--cf-text-2xs)', maxHeight: '60px', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub.failedTestCase.actualOutput}</pre>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Right Pane: Editor & Runner */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--cf-editor-bg)', minWidth: 0, minHeight: 0 }}>
          
          {/* Editor Header / Lang Selector */}
          <div style={{
            display: 'flex', alignItems: 'center', padding: 'var(--cf-space-2) var(--cf-space-4)',
            background: 'var(--cf-bg-raised)', borderBottom: '1px solid var(--cf-border-muted)'
          }}>
            <select 
              value={language} 
              onChange={handleLanguageChange}
              style={{
                background: 'var(--cf-bg-input)', color: 'var(--cf-text-primary)',
                border: '1px solid var(--cf-border-base)', borderRadius: 'var(--cf-radius-sm)',
                padding: 'var(--cf-space-1) var(--cf-space-2)', fontFamily: 'var(--cf-font-ui)',
                outline: 'none', cursor: 'pointer'
              }}
            >
              {LANGUAGES.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}
            </select>
          </div>

          {/* Monaco Editor */}
          <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
            <Editor
              key={language}
              height="100%"
              language={language === 'cpp' ? 'cpp' : language}
              theme="vs-dark"
              defaultValue={code}
              onChange={val => {
                setCode(val);
                setCodes(prev => ({ ...prev, [language]: val }));
              }}
              options={{
                fontFamily: "'JetBrains Mono', Consolas, 'Courier New', monospace",
                fontLigatures: true,
                fontSize: 14,
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                padding: { top: 16 }
              }}
            />
          </div>

          {/* Action Bar & Local Output */}
          <div style={{ borderTop: '1px solid var(--cf-border-muted)', background: 'var(--cf-bg-raised)', display: 'flex', flexDirection: 'column' }}>
            
            {/* Draggable Resizer (only when results are shown) */}
            {hasOutput && (
              <div 
                onMouseDown={handleDragStart}
                style={{
                  height: '6px',
                  background: 'var(--cf-border-strong)',
                  cursor: 'ns-resize',
                  width: '100%',
                  marginTop: '-3px',
                  zIndex: 10,
                  transition: 'background 0.2s'
                }}
                title="Drag to resize"
                onMouseEnter={e => e.currentTarget.style.background = 'var(--cf-accent)'}
                onMouseLeave={e => e.currentTarget.style.background = 'var(--cf-border-strong)'}
              />
            )}

            {/* Close Results Button */}
            {hasOutput && (
              <div style={{ display: 'flex', justifyContent: 'flex-end', padding: 'var(--cf-space-2) var(--cf-space-4)', borderBottom: '1px solid var(--cf-border-base)' }}>
                <button
                  onClick={() => { setSampleResults([]); setSubmitResult(''); setLiveSubmissionId(null); setPracticeResult(null); }}
                  style={{ background: 'none', border: 'none', color: 'var(--cf-text-muted)', cursor: 'pointer', fontFamily: 'var(--cf-font-ui)', fontSize: 'var(--cf-text-sm)', display: 'flex', alignItems: 'center', gap: '4px' }}
                >
                  ✕ Close Results
                </button>
              </div>
            )}

            {/* Output Area */}
            <div style={{ 
              padding: 'var(--cf-space-4)', 
              height: hasOutput ? `${panelHeight}px` : 'auto', 
              overflowY: 'auto' 
            }}>
              {sampleResults.length > 0 && (
                <div className="cf-anim-fade-up">
                  <h4 style={{ margin: '0 0 var(--cf-space-2)', color: 'var(--cf-text-muted)', fontSize: 'var(--cf-text-xs)' }}>Quick-run results (in this browser, not a verdict):</h4>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--cf-space-2)' }}>
                    {sampleResults.map(res => (
                      <div key={res.index} style={{
                        background: 'var(--cf-bg-overlay)', border: '1px solid var(--cf-border-base)',
                        borderRadius: 'var(--cf-radius-sm)', padding: 'var(--cf-space-3)'
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--cf-space-3)', marginBottom: 'var(--cf-space-2)' }}>
                          <span style={{ fontSize: 'var(--cf-text-sm)', fontWeight: 'var(--cf-weight-medium)' }}>Test {res.index}</span>
                          {res.status === 'UNSUPPORTED' ? (
                            <span className="cf-chip cf-chip--re">Client execution not supported for {language}</span>
                          ) : (
                            <span className={`cf-chip ${VERDICT_CHIP[res.status] || 'cf-chip--infra'}`}>{res.status}</span>
                          )}
                        </div>
                        {res.status !== 'UNSUPPORTED' && (
                          <div style={{ display: 'flex', gap: 'var(--cf-space-4)' }}>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontSize: 'var(--cf-text-2xs)', color: 'var(--cf-text-muted)' }}>Input:</div>
                              <pre style={{ margin: 0, padding: 0, background: 'none', border: 'none', color: 'var(--cf-text-secondary)' }}>{res.input}</pre>
                            </div>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontSize: 'var(--cf-text-2xs)', color: 'var(--cf-text-muted)' }}>Expected:</div>
                              <pre style={{ margin: 0, padding: 0, background: 'none', border: 'none', color: 'var(--cf-text-secondary)' }}>{res.expected}</pre>
                            </div>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontSize: 'var(--cf-text-2xs)', color: 'var(--cf-text-muted)' }}>Actual:</div>
                              <pre style={{ margin: 0, padding: 0, background: 'none', border: 'none', color: res.status === 'AC' ? 'var(--cf-success)' : 'var(--cf-danger)' }}>
                                {res.error ? res.error : res.actualOutput}
                              </pre>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              
              {submitResult && (
                <div className="cf-anim-fade-up" style={{
                  padding: 'var(--cf-space-4)', background: 'var(--cf-info-dim)', 
                  border: '1px solid var(--cf-info)', borderRadius: 'var(--cf-radius-md)',
                  color: 'var(--cf-info)', marginBottom: 'var(--cf-space-2)'
                }}>
                  {submitResult}
                </div>
              )}

              {liveSubmissionId && (
                <SubmissionPanel
                  submissionId={liveSubmissionId}
                  onUseFailingCase={(tc) => {
                    if (!tc || !tc.input) return;
                    setLocalTestCases([...(localTestCases || []), { input: tc.input, expectedOutput: tc.expectedOutput || '' }]);
                    setLeftTab('testcases');
                  }}
                />
              )}

              {practiceProgress && !practiceResult && (
                <div className="cf-anim-pulse" style={{ color: 'var(--cf-text-muted)', fontSize: 'var(--cf-text-sm)' }}>
                  Judging in your browser… {practiceProgress.done}/{practiceProgress.total} test cases
                </div>
              )}

              {practiceResult && (
                <div className="cf-anim-fade-up" style={{
                  padding: 'var(--cf-space-4)', background: 'var(--cf-bg-raised)',
                  border: `1px solid ${practiceResult.verdict === 'AC' ? 'var(--cf-success)' : 'var(--cf-danger)'}`,
                  borderRadius: 'var(--cf-radius-md)',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--cf-space-3)', flexWrap: 'wrap' }}>
                    <span className={`cf-chip ${VERDICT_CHIP[practiceResult.verdict] || 'cf-chip--infra'}`}>
                      {practiceResult.verdict}
                    </span>
                    {practiceResult.runtimeMs != null && <span className="cf-chip cf-chip--infra">{practiceResult.runtimeMs}ms</span>}
                    {practiceResult.memoryMB ? <span className="cf-chip cf-chip--infra">{practiceResult.memoryMB.toFixed(1)}MB</span> : null}
                    <span style={{ fontSize: 'var(--cf-text-xs)', color: 'var(--cf-text-muted)' }}>
                      practice · judged in this browser{language === 'python' ? '' : ' (JS memory is approximate)'}
                    </span>
                  </div>
                  {practiceResult.cases?.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--cf-space-2)', marginTop: 'var(--cf-space-3)' }}>
                      {practiceResult.cases.map((c) => (
                        <span key={c.index} className={`cf-chip ${VERDICT_CHIP[c.status] || 'cf-chip--infra'}`} style={{ fontSize: 'var(--cf-text-2xs)' }}>
                          #{c.index + 1} {c.status} {c.wallMs != null ? `${c.wallMs}ms` : ''}{c.memMb ? ` ${c.memMb.toFixed(0)}MB` : ''}
                        </span>
                      ))}
                    </div>
                  )}
                  {practiceResult.error && (
                    <div style={{ color: 'var(--cf-danger)', marginTop: 'var(--cf-space-2)', fontSize: 'var(--cf-text-sm)' }}>{practiceResult.error}</div>
                  )}
                  {practiceResult.failedTestCase && (
                    <div style={{ display: 'flex', gap: 'var(--cf-space-4)', marginTop: 'var(--cf-space-3)' }}>
                      {[['Input', practiceResult.failedTestCase.input, 'var(--cf-text-secondary)'],
                        ['Expected', practiceResult.failedTestCase.expectedOutput, 'var(--cf-text-secondary)'],
                        ['Actual', practiceResult.failedTestCase.actualOutput, 'var(--cf-danger)']].map(([label, val, color]) => (
                        <div key={label} style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 'var(--cf-text-2xs)', color: 'var(--cf-text-muted)' }}>{label}:</div>
                          <pre style={{ margin: 0, padding: 'var(--cf-space-2)', background: 'var(--cf-bg-base)', border: '1px solid var(--cf-border-muted)', borderRadius: 'var(--cf-radius-sm)', fontSize: 'var(--cf-text-xs)', maxHeight: 140, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all', color }}>{val}</pre>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {!hasOutput && !practiceProgress && (
                <div style={{ color: 'var(--cf-text-muted)', fontSize: 'var(--cf-text-sm)', fontStyle: 'italic' }}>
                  {clientJudged
                    ? "Practice problem — 'Submit' judges it right here in your browser. 'Run Samples' does a quick check."
                    : "'Run Samples' for a local check, or 'Submit for Verdict' for server grading."}
                </div>
              )}
            </div>

            {/* Buttons */}
            <div style={{ 
              display: 'flex', gap: 'var(--cf-space-4)', padding: 'var(--cf-space-4)',
              borderTop: '1px solid var(--cf-border-muted)'
            }}>
              <button
                onClick={handleRunSamples}
                disabled={sampleRunning || submitting}
                style={{
                  background: 'var(--cf-bg-overlay)', border: '1px solid var(--cf-border-base)', color: 'var(--cf-text-primary)',
                  padding: 'var(--cf-space-2) var(--cf-space-5)', borderRadius: 'var(--cf-radius-md)', cursor: 'pointer',
                  fontWeight: 'var(--cf-weight-medium)', display: 'flex', alignItems: 'center', gap: 'var(--cf-space-2)',
                  opacity: (sampleRunning || submitting) ? 0.5 : 1
                }}
              >
                {sampleRunning && <span className="cf-anim-spin" style={{ display: 'inline-block', width: 14, height: 14, borderRadius: '50%', border: '2px solid var(--cf-border-strong)', borderTopColor: 'var(--cf-text-primary)' }} />}
                Run Samples
              </button>
              
              {/* Visually distinct Submit button */}
              <button
                onClick={handleSubmit}
                disabled={sampleRunning || submitting}
                style={{
                  background: 'var(--cf-accent)', border: 'none', color: '#fff', marginLeft: 'auto',
                  padding: 'var(--cf-space-2) var(--cf-space-6)', borderRadius: 'var(--cf-radius-md)', cursor: 'pointer',
                  fontWeight: 'var(--cf-weight-bold)', display: 'flex', alignItems: 'center', gap: 'var(--cf-space-2)',
                  boxShadow: 'var(--cf-shadow-sm)', opacity: (sampleRunning || submitting) ? 0.5 : 1
                }}
              >
                {submitting && <span className="cf-anim-spin" style={{ display: 'inline-block', width: 14, height: 14, borderRadius: '50%', border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff' }} />}
                {clientJudged ? 'Judge in Browser' : 'Submit for Verdict'}
              </button>
            </div>
          </div>
          
        </div>
      </div>
    </div>
  );
}
