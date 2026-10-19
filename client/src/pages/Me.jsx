import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import Shell from '../components/Shell.jsx';
import { Chip } from '../components/Verdict.jsx';
import { useAuth } from '../hooks/useAuth.js';
import { useProfile } from '../hooks/useProfile.js';
import { renameMe } from '../lib/auth.js';
import { loadStats, loadMySubmissions } from '../lib/submissions.js';
import { setName, resetProfile, exportProfile, importProfile } from '../lib/profile.js';
import { dbConfigured } from '../lib/supabase.js';
import { LANGUAGES } from '../lib/starters.js';
import './Admin.css';
import './Me.css';

const LANG_LABEL = Object.fromEntries(LANGUAGES.map((l) => [l.id, l.label]));
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

export default function Me() {
  const { ready, user } = useAuth();
  if (!ready) return <Shell><div className="cat-loading">Loading…</div></Shell>;
  return user ? <Dashboard /> : <GuestProfile />;
}

// ── signed in: progress from the database ──────────────────────────────────
function Dashboard() {
  const { profile, isAdmin } = useAuth();
  const [stats, setStats] = useState(null);
  const [recent, setRecent] = useState(null);
  const [err, setErr] = useState('');
  const [name, setNameDraft] = useState(profile?.username || '');
  const [msg, setMsg] = useState('');

  useEffect(() => {
    loadStats().then(setStats).catch((e) => setErr(e.message));
    loadMySubmissions({ limit: 15 }).then(setRecent).catch((e) => setErr(e.message));
  }, []);

  async function rename(e) {
    e.preventDefault();
    const n = name.trim();
    if (n.length < 2 || n.length > 32) { setMsg('Username must be 2–32 characters.'); return; }
    try { await renameMe(n); setMsg('Saved.'); } catch (e2) { setMsg(e2.message); }
    setTimeout(() => setMsg(''), 2000);
  }

  const solvedPct = stats ? pct(stats.solved, stats.total) : 0;

  return (
    <Shell>
      <div className="dash-head">
        <h1 className="page-h1">{profile?.username}</h1>
        {isAdmin && <span className="pill pill--admin">admin</span>}
      </div>
      <p className="page-lede">Your progress across every published problem. Every Judge run is saved here.</p>

      {err && <div className="notice notice--error">{err}</div>}

      <div className="dash-grid">
        <div className="card dash-progress">
          <span className="dash-label">Problems solved</span>
          <div className="dash-big">
            {stats ? <>{stats.solved}<small> / {stats.total}</small></> : '…'}
          </div>
          <div className="dash-bar" role="progressbar" aria-valuenow={solvedPct} aria-valuemin={0} aria-valuemax={100}>
            <div style={{ width: `${solvedPct}%` }} />
          </div>
          <span className="dash-note">{stats ? `${solvedPct}% of all problems` : ''}</span>
        </div>

        <div className="card dash-diffs">
          <span className="dash-label">By difficulty</span>
          {(stats?.by_difficulty || []).map((d) => (
            <div key={d.difficulty} className="dash-diff">
              <span className={`cat-diff cat-diff--${d.difficulty}`}>{d.difficulty}</span>
              <div className={`dash-bar dash-bar--${d.difficulty}`}><div style={{ width: `${pct(d.solved, d.total)}%` }} /></div>
              <span className="dash-frac">{d.solved}/{d.total}</span>
            </div>
          ))}
        </div>

        <div className="card dash-mini">
          <span className="dash-label">Submissions</span>
          <div className="dash-big">{stats ? stats.submissions : '…'}</div>
          <span className="dash-note">{stats ? `${stats.accepted} accepted · ${pct(stats.accepted, stats.submissions)}% acceptance rate` : ''}</span>
        </div>
      </div>

      <h2 className="dash-h2">Recent submissions</h2>
      {recent && recent.length === 0 && (
        <div className="card dash-empty">No submissions yet. <Link to="/">Pick a problem</Link> and click Judge.</div>
      )}
      {recent && recent.length > 0 && (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead><tr><th>Problem</th><th>Verdict</th><th>Language</th><th>Tests passed</th><th>Time</th><th>When</th></tr></thead>
            <tbody>
              {recent.map((s) => (
                <tr key={s.id}>
                  <td><Link className="admin-title" to={`/p/${s.problems?.slug}`}>{s.problems?.title ?? 'deleted problem'}</Link></td>
                  <td><Chip v={s.verdict} /></td>
                  <td>{LANG_LABEL[s.language] || s.language}</td>
                  <td className="admin-num">{s.passed}/{s.total}</td>
                  <td className="admin-num">{s.runtime_ms != null ? `${s.runtime_ms} ms` : '—'}</td>
                  <td className="admin-num">{new Date(s.created_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2 className="dash-h2">Account</h2>
      <form className="card me-card" onSubmit={rename}>
        <label>Username</label>
        <div className="me-row">
          <input value={name} onChange={(e) => setNameDraft(e.target.value)} maxLength={32} />
          <button className="btn-primary" type="submit">Save</button>
        </div>
        {msg && <p>{msg}</p>}
      </form>
    </Shell>
  );
}

// ── guest: progress kept in this browser only ──────────────────────────────
function GuestProfile() {
  const profile = useProfile();
  const [draftName, setDraftName] = useState(profile.name);
  const fileRef = useRef(null);
  const [msg, setMsg] = useState('');

  function save(e) {
    e.preventDefault();
    setName(draftName);
    setMsg('Saved.');
    setTimeout(() => setMsg(''), 1500);
  }

  function download() {
    const blob = new Blob([exportProfile()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'codeforge-profile.json';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function onImport(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    f.text().then((t) => {
      setMsg(importProfile(t) ? 'Imported.' : 'That doesn’t look like a profile file.');
      setDraftName(profile.name);
      setTimeout(() => setMsg(''), 2500);
    });
  }

  return (
    <Shell>
      <h1 className="me-h1">Your profile</h1>
      <p className="me-lede">
        You’re not logged in, so your name, solved list and code drafts live only in this browser’s storage.
      </p>

      {dbConfigured && (
        <div className="card dash-cta">
          <div>
            <b>Log in to save every submission and see your progress dashboard.</b>
            <p>Solved count out of all problems, results by difficulty, and your submission history — on any device.</p>
          </div>
          <Link to="/login" state={{ from: '/me' }} className="btn-primary">Log in or sign up</Link>
        </div>
      )}

      {msg && <div className="me-msg">{msg}</div>}

      <form className="me-card" onSubmit={save}>
        <label>Display name</label>
        <div className="me-row">
          <input value={draftName} onChange={(e) => setDraftName(e.target.value)} placeholder="e.g. ada" maxLength={40} />
          <button className="btn-primary" type="submit">Save</button>
        </div>
      </form>

      <div className="me-card">
        <div className="me-stat"><b>{profile.solved.length}</b> problem{profile.solved.length === 1 ? '' : 's'} solved in this browser</div>
        {profile.solved.length > 0 && (
          <ul className="me-solved">{profile.solved.map((s) => <li key={s}>{s}</li>)}</ul>
        )}
      </div>

      <div className="me-card">
        <label>Backup &amp; restore</label>
        <div className="me-row">
          <button className="btn-ghost" onClick={download} type="button">Export profile</button>
          <button className="btn-ghost" onClick={() => fileRef.current?.click()} type="button">Import profile</button>
          <input ref={fileRef} type="file" accept="application/json" hidden onChange={onImport} />
        </div>
      </div>

      <div className="me-card me-danger">
        <label>Reset</label>
        <p>Clears your name, solved list and all code drafts from this browser.</p>
        <button className="btn-ghost" type="button" onClick={() => { if (confirm('Erase everything stored in this browser?')) resetProfile(); }}>
          Erase local data
        </button>
      </div>
    </Shell>
  );
}
