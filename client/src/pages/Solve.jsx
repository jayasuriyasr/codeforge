import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import Editor from '@monaco-editor/react';
import Shell from '../components/Shell.jsx';
import Verdict, { Chip } from '../components/Verdict.jsx';
import { loadProblem, loadAllTestCases } from '../lib/problems.js';
import { renderMarkdown } from '../lib/md.js';
import { LANGUAGES, MONACO_LANG, STARTERS } from '../lib/starters.js';
import { getDraft, saveDraft, getLang, setLang, markSolved } from '../lib/profile.js';
import { saveSubmission, loadMySubmissions } from '../lib/submissions.js';
import { useAuth } from '../hooks/useAuth.js';
import { useSolved, markSolvedId } from '../hooks/useSolved.js';
import {
  judgePractice, runSample, runCustom, warmup, checkToolchain, toolchainInfo,
} from '../judge/index.js';
import './Solve.css';

const EXPERIMENTAL = new Set(['c', 'cpp', 'java']);
const LANG_LABEL = Object.fromEntries(LANGUAGES.map((l) => [l.id, l.label]));
const CUSTOM_STATUS = { OK: 'Ran successfully', TLE: 'Time Limit Exceeded', MLE: 'Memory Limit Exceeded', RE: 'Runtime Error', CE: 'Compile Error', UNAVAILABLE: 'Toolchain unavailable', UNSUPPORTED: 'Language not supported' };

export default function Solve() {
  const { slug } = useParams();
  const [problem, setProblem] = useState(null);
  const [err, setErr] = useState('');

  const [language, setLanguage] = useState(() => getLang());
  const [code, setCode] = useState('');
  const editorRef = useRef(null);

  const { user } = useAuth();
  const isSolved = useSolved();

  const [tab, setTab] = useState('statement'); // statement | tests | custom | subs
  const [samples, setSamples] = useState([]);   // Run-samples results
  const [customInput, setCustomInput] = useState('');
  const [customResult, setCustomResult] = useState(null);
  const [saveNote, setSaveNote] = useState(null); // { ok, text } after a judged run
  const [mySubs, setMySubs] = useState(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(null);
  const [stage, setStage] = useState('');       // human hint while running
  const [result, setResult] = useState(null);
  const [toolchain, setToolchain] = useState(null); // { ok, error } for experimental langs
  const [everRan, setEverRan] = useState(() => new Set()); // langs compiled at least once this session

  // ── load problem ─────────────────────────────────────────────────────────
  useEffect(() => {
    setProblem(null); setErr(''); setResult(null); setSamples([]);
    setCustomResult(null); setSaveNote(null); setMySubs(null);
    loadProblem(slug)
      .then((p) => {
        setProblem(p);
        setCustomInput(p.testCases.find((c) => c.sample)?.input ?? '');
      })
      .catch((e) => setErr(e.message));
  }, [slug]);

  // ── my submissions for this problem (signed in) ─────────────────────────
  const problemId = problem?.id;
  useEffect(() => {
    if (tab !== 'subs' || !user || !problemId || mySubs) return;
    loadMySubmissions({ problemId, limit: 30, withCode: true })
      .then(setMySubs)
      .catch((e) => setMySubs({ error: e.message }));
  }, [tab, user, problemId, mySubs]);

  // ── load draft when problem / language changes ───────────────────────────
  useEffect(() => {
    if (!problem) return;
    const saved = getDraft(slug, language);
    setCode(saved ?? STARTERS[language] ?? '');
  }, [problem, slug, language]);

  // ── experimental toolchain check ────────────────────────────────────────
  useEffect(() => {
    if (!EXPERIMENTAL.has(language)) { setToolchain(null); return; }
    setToolchain('checking');
    let alive = true;
    warmup(language);
    checkToolchain(language).then((r) => { if (alive) setToolchain(r); });
    return () => { alive = false; };
  }, [language]);

  const sampleCases = useMemo(
    () => (problem?.testCases || []).filter((c) => c.sample),
    [problem],
  );

  function onCode(v) {
    const next = v ?? '';
    setCode(next);
    saveDraft(slug, language, next);
  }

  function pickLanguage(id) {
    saveDraft(slug, language, code);
    setLanguage(id); setLang(id);
    warmup(id);
    setSamples([]); setResult(null);
  }

  const NEEDS_BUILD = new Set(['c', 'cpp', 'java']);
  const NEEDS_DOWNLOAD = new Set(['python', 'c', 'cpp', 'java']);   // a runtime is fetched on first use

  function firstBuildHint() {
    if (!NEEDS_DOWNLOAD.has(language) || everRan.has(language)) return '';
    const tc = toolchainInfo(language);
    if (!NEEDS_BUILD.has(language)) {
      return `Loading ${tc?.label || language} — the first run in this browser may download ~${tc?.approxMB || 12} MB (saved for next time)…`;
    }
    return `Preparing ${tc?.label || language} — the first run downloads ~${tc?.approxMB || 20} MB `
      + 'and compiles your code. This can take up to a minute; later runs are quick.';
  }

  async function handleRunSamples() {
    if (!problem) return;
    setTab('tests');
    setRunning(true); setResult(null); setSamples([]);
    setStage(firstBuildHint() || 'Running sample tests…');
    const out = [];
    for (let i = 0; i < sampleCases.length; i++) {
      setProgress({ done: i, total: sampleCases.length });
      if (everRan.has(language) || !NEEDS_DOWNLOAD.has(language)) {
        setStage(`Running sample ${i + 1} of ${sampleCases.length}…`);
      }
      const tc = sampleCases[i];
      const r = await runSample({
        language, code, input: tc.input, expectedOutput: tc.expectedOutput,
        checkerType: problem.checkerType, timeLimitSec: problem.timeLimitSec,
        memoryLimitMB: problem.memoryLimitMB,
      });
      out.push({ i: i + 1, input: tc.input, expected: tc.expectedOutput, ...r });
      setSamples([...out]);
      if (NEEDS_DOWNLOAD.has(language)) setEverRan((s) => new Set(s).add(language));
    }
    setRunning(false); setProgress(null); setStage('');
  }

  async function handleRunCustom() {
    if (!problem) return;
    setTab('custom');
    setRunning(true); setCustomResult(null);
    setStage(firstBuildHint() || 'Running your input…');
    try {
      const r = await runCustom({
        language, code, input: customInput,
        timeLimitSec: problem.timeLimitSec, memoryLimitMB: problem.memoryLimitMB,
      });
      setCustomResult(r);
      if (NEEDS_DOWNLOAD.has(language)) setEverRan((s) => new Set(s).add(language));
    } finally {
      setRunning(false); setStage('');
    }
  }

  async function storeSubmission(r) {
    if (!user) {
      setSaveNote({ ok: false, guest: true, text: 'Not saved — log in to keep a history of your submissions.' });
      return;
    }
    try {
      const saved = await saveSubmission({
        problemId: problem.id, language, code, result: r, totalCases: problem.caseCount,
      });
      if (saved) {
        if (r.verdict === 'AC') markSolvedId(problem.id);
        setMySubs(null); // refetch on next open
        setSaveNote({ ok: true, text: 'Saved to your submissions.' });
      }
    } catch (e) {
      setSaveNote({ ok: false, text: `Couldn’t save this submission: ${e.message}` });
    }
  }

  async function handleJudge() {
    if (!problem) return;
    setSaveNote(null);
    setRunning(true); setResult(null); setSamples([]);
    setProgress({ done: 0, total: problem.caseCount });
    let testCases;
    try {
      if (!problem.allCasesLoaded) setStage(`Downloading ${problem.caseCount} test cases…`);
      testCases = await loadAllTestCases(problem);
    } catch (e) {
      setResult({ verdict: 'NETWORK', error: String(e.message || e), cases: [] });
      setRunning(false); setProgress(null); setStage('');
      return;
    }
    setStage(firstBuildHint() || 'Judging every test case…');
    try {
      const r = await judgePractice({
        language, code, problem: { ...problem, testCases },
        onProgress: (p) => {
          setProgress({ done: p.done, total: p.total });
          if (NEEDS_DOWNLOAD.has(language)) setEverRan((s) => new Set(s).add(language));
          setStage(`Judging case ${p.done} of ${p.total}…`);
        },
      });
      setResult(r);
      if (r.verdict === 'AC' && !user) markSolved(slug);   // guests: progress kept in this browser
      storeSubmission(r);
    } catch (e) {
      setResult({ verdict: 'RE', error: String(e.message || e), cases: [] });
    } finally {
      setRunning(false); setProgress(null); setStage('');
    }
  }

  function loadCaseInput(tc) {
    setTab('tests');
    // stash it as a "custom sample" so the user can Run it
    setSamples([{ i: 0, input: tc.input, expected: tc.expectedOutput, status: 'PENDING', actualOutput: '' }]);
  }

  function loadSubmissionCode(s) {
    if (s.language !== language) {
      saveDraft(slug, language, code);
      setLanguage(s.language); setLang(s.language);
      warmup(s.language);
    }
    // The draft effect reloads the editor from the saved draft on a language
    // change, so store this submission's code as that draft first.
    saveDraft(slug, s.language, s.code);
    setCode(s.code);
    setResult(null); setSamples([]);
  }

  if (err) {
    return <Shell><div className="solve-error">Couldn’t load “{slug}”: {err} <Link to="/">← all problems</Link></div></Shell>;
  }
  if (!problem) {
    return <Shell><div className="solve-loading">Loading…</div></Shell>;
  }

  const jsMemNote = language === 'javascript' && (
    <span className="solve-tc" title="Browsers don't let a page measure a worker's JavaScript memory. Python, C and C++ memory is measured exactly.">
      memory limit not measured for JavaScript
    </span>
  );

  const tcBadge = EXPERIMENTAL.has(language) && (
    <span className="solve-tc">
      {toolchain === 'checking' && <>preparing {toolchainInfo(language)?.label}…</>}
      {toolchain && toolchain !== 'checking' && toolchain.ok && <>{toolchainInfo(language)?.label} · experimental · first run downloads ~{toolchainInfo(language)?.approxMB} MB (cached after)</>}
      {toolchain && toolchain !== 'checking' && !toolchain.ok && <span className="solve-tc-bad">⚠ {toolchainInfo(language)?.label} unavailable — {toolchain.error}</span>}
    </span>
  );

  return (
    <Shell wide>
      <div className="solve">
        <section className="solve-left">
          <div className="solve-lhead">
            <Link to="/" className="solve-back">← Problems</Link>
            <h1>
              {problem.title} {isSolved(problem) && <span className="solve-done">✓ solved</span>}
              {!problem.published && <span className="pill pill--draft solve-draft">draft — only you can see this</span>}
            </h1>
            <div className="solve-limits">
              <span className={`cat-diff cat-diff--${problem.difficulty}`}>{problem.difficulty}</span>
              <span>{problem.timeLimitSec}s</span><span>{problem.memoryLimitMB}MB</span>
              <span>{problem.caseCount} test cases</span>
            </div>
          </div>

          <div className="solve-tabs">
            <button className={tab === 'statement' ? 'on' : ''} onClick={() => setTab('statement')}>Statement</button>
            <button className={tab === 'tests' ? 'on' : ''} onClick={() => setTab('tests')}>Sample tests ({sampleCases.length})</button>
            <button className={tab === 'custom' ? 'on' : ''} onClick={() => setTab('custom')}>Custom input</button>
            {user && <button className={tab === 'subs' ? 'on' : ''} onClick={() => setTab('subs')}>My submissions</button>}
          </div>

          <div className="solve-scroll">
            {tab === 'statement' && (
              <article className="solve-md" dangerouslySetInnerHTML={{ __html: renderMarkdown(problem.statement) }} />
            )}
            {tab === 'tests' && (
              <div className="solve-tests">
                {samples.length > 0 && (
                  <div className="solve-samples">
                    {samples.map((s) => (
                      <div key={s.i} className="solve-sample">
                        <div className="solve-sample-h">
                          <span>Test {s.i || '·'}</span>
                          {s.status === 'PENDING'
                            ? <button onClick={handleRunSamples}>Run</button>
                            : <Chip v={s.status === 'AC' ? 'AC' : s.status === 'WA' ? 'WA' : s.status}>{s.status}{s.wallMs != null ? ` ${s.wallMs}ms` : ''}</Chip>}
                        </div>
                        <div className="solve-sample-cols">
                          <div><label>Input</label><pre>{s.input || '(empty)'}</pre></div>
                          <div><label>Expected</label><pre>{s.expected}</pre></div>
                          {s.status !== 'PENDING' && <div><label>Actual</label><pre className={s.status === 'AC' ? '' : 'v-actual'}>{s.actualOutput}</pre></div>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {sampleCases.map((c, i) => (
                  <div key={i} className="solve-sample">
                    <div className="solve-sample-h"><span>Sample {i + 1}{c.label ? ` — ${c.label}` : ''}</span></div>
                    <div className="solve-sample-cols">
                      <div><label>Input</label><pre>{c.input || '(empty)'}</pre></div>
                      <div><label>Expected</label><pre>{c.expectedOutput}</pre></div>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {tab === 'custom' && (
              <div className="solve-custom">
                <p className="solve-custom-help">
                  Try your code on your own input. You’ll see exactly what your program prints — there is no expected
                  answer here, so it isn’t marked right or wrong.
                </p>
                <label className="field">
                  <span>Your input</span>
                  <textarea rows={7} value={customInput} onChange={(e) => setCustomInput(e.target.value)} spellCheck={false} />
                </label>
                <button className="btn-ghost" disabled={running} onClick={handleRunCustom}>
                  {running ? 'Running…' : 'Run with this input'}
                </button>
                {running && stage && <p className="solve-custom-help">{stage}</p>}
                {customResult && (
                  <div className="solve-sample">
                    <div className="solve-sample-h">
                      <span>Your output</span>
                      <Chip v={customResult.status === 'OK' ? 'AC' : customResult.status}>
                        {CUSTOM_STATUS[customResult.status] || customResult.status}
                        {customResult.wallMs != null ? ` · ${customResult.wallMs}ms` : ''}
                      </Chip>
                    </div>
                    <pre className="solve-custom-out">{customResult.output || '(no output)'}</pre>
                  </div>
                )}
              </div>
            )}
            {tab === 'subs' && user && (
              <div className="solve-subs">
                {!mySubs && <div className="solve-loading">Loading…</div>}
                {mySubs?.error && <div className="notice notice--error">{mySubs.error}</div>}
                {Array.isArray(mySubs) && mySubs.length === 0 && <p className="solve-custom-help">No submissions for this problem yet. Click Judge to make one.</p>}
                {Array.isArray(mySubs) && mySubs.map((s) => (
                  <div key={s.id} className="solve-sub">
                    <Chip v={s.verdict} />
                    <span>{LANG_LABEL[s.language] || s.language}</span>
                    <span className="solve-sub-meta">{s.passed}/{s.total} tests{s.runtime_ms != null ? ` · ${s.runtime_ms}ms` : ''}</span>
                    <span className="solve-sub-meta">{new Date(s.created_at).toLocaleString()}</span>
                    <button className="btn-ghost btn-sm" onClick={() => loadSubmissionCode(s)}>Load code</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="solve-right">
          <div className="solve-toolbar">
            <select value={language} onChange={(e) => pickLanguage(e.target.value)}>
              {LANGUAGES.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
            </select>
            {tcBadge}
            {jsMemNote}
          </div>

          <div className="solve-editor">
            <Editor
              key={language}
              defaultLanguage={MONACO_LANG[language]}
              theme="vs-dark"
              value={code}
              onChange={onCode}
              onMount={(ed) => { editorRef.current = ed; }}
              options={{
                fontSize: 13, minimap: { enabled: false }, scrollBeyondLastLine: false,
                fontFamily: "var(--cf-font-code, 'JetBrains Mono', monospace)", padding: { top: 12 },
                tabSize: 4, automaticLayout: true,
              }}
            />
          </div>

          <div className="solve-run">
            <div className="solve-result">
              <Verdict result={result} running={running && tab !== 'custom'} progress={progress} stage={stage} onUseCase={loadCaseInput} />
              {result && saveNote && (
                <div className={`solve-save ${saveNote.ok ? 'is-ok' : ''}`}>
                  {saveNote.text}
                  {saveNote.guest && <> <Link to="/login" state={{ from: `/p/${slug}` }}>Log in</Link></>}
                </div>
              )}
            </div>
            <div className="solve-buttons">
              <button className="btn-ghost" disabled={running} onClick={handleRunSamples}>Run samples</button>
              <button className="btn-primary" disabled={running || (toolchain && toolchain !== 'checking' && !toolchain.ok)} onClick={handleJudge}>
                {running ? 'Judging…' : 'Judge'}
              </button>
            </div>
          </div>
        </section>
      </div>
    </Shell>
  );
}
