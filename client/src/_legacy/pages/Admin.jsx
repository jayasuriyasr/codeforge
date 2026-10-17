import React, { useState, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { authFetch } from '../api/client';
import './Admin.css';

const BLANK_PROBLEM = {
  title: '', slug: '', statement: '', timeLimitSec: 2.0, memoryLimitMB: 256,
  difficulty: 'medium', mode: 'practice', checkerType: 'exact',
  checker: { language: 'cpp', source: '' }, testCases: [],
};

function ProblemEditor({ editing, onSaved }) {
  const [formData, setFormData] = useState(BLANK_PROBLEM);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    if (editing) {
      setFormData({ ...BLANK_PROBLEM, ...editing, checker: editing.checker || BLANK_PROBLEM.checker });
      setSuccess('');
      setError('');
    }
  }, [editing]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    const payload = {
      ...formData,
      timeLimitSec: parseFloat(formData.timeLimitSec),
      memoryLimitMB: parseFloat(formData.memoryLimitMB),
    };
    if (formData.checkerType !== 'special') delete payload.checker;

    const res = editing
      ? await authFetch(`/api/v1/problems/${editing._id}`, { method: 'PUT', body: JSON.stringify(payload) })
      : await authFetch('/api/v1/problems', { method: 'POST', body: JSON.stringify(payload) });

    if (!res.ok) {
      setError(res.data?.error || 'Failed to save problem.');
    } else {
      setSuccess(editing ? 'Problem updated.' : 'Problem created.');
      if (!editing) setFormData(BLANK_PROBLEM);
      onSaved?.();
    }
  };

  const addTestCase = (isSample) => {
    setFormData({
      ...formData,
      testCases: [...formData.testCases, { input: '', expectedOutput: '', isSample, label: '' }]
    });
  };

  const updateTestCase = (index, field, value) => {
    const newTCs = [...formData.testCases];
    newTCs[index][field] = value;
    setFormData({ ...formData, testCases: newTCs });
  };

  const removeTestCase = (index) => {
    const newTCs = [...formData.testCases];
    newTCs.splice(index, 1);
    setFormData({ ...formData, testCases: newTCs });
  };

  return (
    <div className="admin-tab-content cf-anim-fade-in">
      <h2 className="admin-section-title">Problem Editor</h2>
      {error && <div className="cf-alert cf-alert-danger">{error}</div>}
      {success && <div className="cf-alert cf-alert-success">{success}</div>}
      
      <form onSubmit={handleSubmit} className="admin-form">
        <div className="form-group">
          <label>Title</label>
          <input type="text" required value={formData.title} onChange={e => setFormData({...formData, title: e.target.value})} />
        </div>
        <div className="form-group">
          <label>Slug</label>
          <input type="text" required value={formData.slug} onChange={e => setFormData({...formData, slug: e.target.value})} />
        </div>
        <div className="form-group">
          <label>Statement (Markdown)</label>
          <textarea required rows="4" value={formData.statement} onChange={e => setFormData({...formData, statement: e.target.value})} />
        </div>
        <div className="form-row">
          <div className="form-group">
            <label>Time Limit (s)</label>
            <input type="number" step="0.1" required value={formData.timeLimitSec} onChange={e => setFormData({...formData, timeLimitSec: e.target.value})} />
          </div>
          <div className="form-group">
            <label>Memory Limit (MB)</label>
            <input type="number" required value={formData.memoryLimitMB} onChange={e => setFormData({...formData, memoryLimitMB: e.target.value})} />
          </div>
          <div className="form-group">
            <label>Difficulty</label>
            <select value={formData.difficulty} onChange={e => setFormData({...formData, difficulty: e.target.value})}>
              <option value="easy">Easy</option>
              <option value="medium">Medium</option>
              <option value="hard">Hard</option>
            </select>
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label>Mode</label>
            <select value={formData.mode} onChange={e => setFormData({...formData, mode: e.target.value})}>
              <option value="practice">Practice — all test cases public, judged in-browser</option>
              <option value="contest">Contest — only sample cases public, hidden cases judged server-side</option>
            </select>
          </div>
          <div className="form-group">
            <label>Checker</label>
            <select value={formData.checkerType} onChange={e => setFormData({...formData, checkerType: e.target.value})}>
              <option value="exact">exact</option>
              <option value="float">float (epsilon)</option>
              <option value="special">special (custom program)</option>
            </select>
          </div>
        </div>
        {formData.checkerType === 'special' && (
          <div className="form-row">
            <div className="form-group" style={{ flex: '0 0 140px' }}>
              <label>Checker language</label>
              <select value={formData.checker.language} onChange={e => setFormData({ ...formData, checker: { ...formData.checker, language: e.target.value } })}>
                <option value="cpp">C++</option>
                <option value="c">C</option>
                <option value="python">Python</option>
                <option value="javascript">JavaScript</option>
              </select>
            </div>
            <div className="form-group">
              <label>Checker source — reads argv[1..3] = input, output, expected; exit 0 = AC, non-zero = WA</label>
              <textarea rows="6" style={{ fontFamily: 'var(--cf-font-mono)', fontSize: 'var(--cf-text-xs)' }}
                value={formData.checker.source}
                onChange={e => setFormData({ ...formData, checker: { ...formData.checker, source: e.target.value } })} />
            </div>
          </div>
        )}

        <div className="test-cases-section">
          <h3>Test Cases</h3>
          <div className="tc-buttons">
            <button type="button" className="cf-btn cf-btn-secondary" onClick={() => addTestCase(true)}>+ Sample (public)</button>
            <button type="button" className="cf-btn cf-btn-secondary" onClick={() => addTestCase(false)}>+ Hidden</button>
          </div>
          <div className="tc-list">
            {formData.testCases.map((tc, idx) => (
              <div key={idx} className="tc-item cf-panel">
                <div className="tc-header">
                  <h4>{tc.isSample ? 'Sample (public)' : 'Hidden'} Test Case #{idx + 1}</h4>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    {!tc.isSample && formData.mode === 'contest' && (
                      <label style={{ fontSize: 'var(--cf-text-xs)', display: 'flex', gap: 4, alignItems: 'center' }}>
                        <input type="checkbox" checked={!!tc.pretest} onChange={e => updateTestCase(idx, 'pretest', e.target.checked)} />
                        pretest
                      </label>
                    )}
                    <button type="button" className="cf-btn cf-btn-danger cf-btn-sm" onClick={() => removeTestCase(idx)}>Remove</button>
                  </div>
                </div>
                <div className="form-group">
                  <label>Label (optional)</label>
                  <input type="text" value={tc.label} onChange={e => updateTestCase(idx, 'label', e.target.value)} />
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label>Input</label>
                    <textarea required rows="3" value={tc.input} onChange={e => updateTestCase(idx, 'input', e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label>Expected Output</label>
                    <textarea required rows="3" value={tc.expectedOutput} onChange={e => updateTestCase(idx, 'expectedOutput', e.target.value)} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
        <button type="submit" className="cf-btn cf-btn-primary">Create Problem</button>
      </form>
    </div>
  );
}

function ContestManager() {
  const [formData, setFormData] = useState({
    title: '', description: '', startTime: '', endTime: '', problemIds: []
  });
  const [problems, setProblems] = useState([]);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    authFetch('/api/v1/problems').then(({ ok, data }) => {
      if (ok) setProblems(data.problems || []);
    });
  }, []);

  const toggleProblem = (pid) => {
    setFormData((f) => ({
      ...f,
      problemIds: f.problemIds.includes(pid)
        ? f.problemIds.filter((x) => x !== pid)
        : [...f.problemIds, pid],
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    const res = await authFetch('/api/v1/contests', {
      method: 'POST',
      body: JSON.stringify({
        ...formData,
        startTime: new Date(formData.startTime).toISOString(),
        endTime: new Date(formData.endTime).toISOString(),
      }),
    });

    if (!res.ok) {
      setError(res.data?.error || 'Failed to create contest.');
    } else {
      setSuccess(`Contest created. Share /contests/${res.data.contest._id} with participants.`);
      setFormData({ title: '', description: '', startTime: '', endTime: '', problemIds: [] });
    }
  };

  return (
    <div className="admin-tab-content cf-anim-fade-in">
      <h2 className="admin-section-title">Contest Manager</h2>
      {error && <div className="cf-alert cf-alert-danger">{error}</div>}
      {success && <div className="cf-alert cf-alert-success">{success}</div>}

      <form onSubmit={handleSubmit} className="admin-form">
        <div className="form-group">
          <label>Title</label>
          <input type="text" required value={formData.title} onChange={e => setFormData({...formData, title: e.target.value})} />
        </div>
        <div className="form-group">
          <label>Description</label>
          <textarea rows="2" value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} />
        </div>
        <div className="form-row">
          <div className="form-group">
            <label>Start Time</label>
            <input type="datetime-local" required value={formData.startTime} onChange={e => setFormData({...formData, startTime: e.target.value})} />
          </div>
          <div className="form-group">
            <label>End Time</label>
            <input type="datetime-local" required value={formData.endTime} onChange={e => setFormData({...formData, endTime: e.target.value})} />
          </div>
        </div>
        <div className="form-group">
          <label>Problems ({formData.problemIds.length} selected)</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 200, overflowY: 'auto', border: '1px solid var(--cf-border-base)', borderRadius: 'var(--cf-radius-sm)', padding: 'var(--cf-space-2)' }}>
            {problems.map((p) => (
              <label key={p._id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 'var(--cf-text-sm)' }}>
                <input type="checkbox" checked={formData.problemIds.includes(p._id)} onChange={() => toggleProblem(p._id)} />
                {p.title} <span style={{ color: 'var(--cf-text-muted)' }}>({p.mode || 'practice'})</span>
              </label>
            ))}
            {problems.length === 0 && <span style={{ color: 'var(--cf-text-muted)' }}>Create a problem first.</span>}
          </div>
        </div>
        <button type="submit" className="cf-btn cf-btn-primary">Create Contest</button>
      </form>
    </div>
  );
}

function SubmissionMonitor() {
  const [submissions, setSubmissions] = useState([]);

  useEffect(() => {
    let mounted = true;
    const fetchSubs = async () => {
      const res = await authFetch('/api/v1/submissions/admin/recent');
      if (mounted && res.ok && res.data) {
        setSubmissions(res.data.submissions);
      }
    };
    fetchSubs();
    const intv = setInterval(fetchSubs, 3000);
    return () => { mounted = false; clearInterval(intv); };
  }, []);

  return (
    <div className="admin-tab-content cf-anim-fade-in">
      <h2 className="admin-section-title">Submission Monitor</h2>
      <p className="monitor-subtitle">Real-time view of recent queue activity (spotting INFRA_ERROR)</p>
      
      <div className="monitor-table-wrapper cf-surface">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Language</th>
              <th>Status</th>
              <th>Verdict</th>
            </tr>
          </thead>
          <tbody>
            {submissions.map(sub => {
              const isInfra = sub.status === 'ERROR';
              return (
                <tr key={sub._id} className={isInfra ? 'infra-error-row' : ''}>
                  <td>{new Date(sub.createdAt).toLocaleTimeString()}</td>
                  <td>{sub.language}</td>
                  <td>{sub.status}</td>
                  <td>
                    {isInfra ? (
                      <span className="cf-chip cf-chip--wa" title={sub.error || ''}>ERROR</span>
                    ) : (
                      sub.verdict || '--'
                    )}
                  </td>
                </tr>
              );
            })}
            {submissions.length === 0 && (
              <tr><td colSpan="4" className="empty-state">No recent submissions</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ProblemList({ onEdit }) {
  const [problems, setProblems] = useState([]);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    authFetch('/api/v1/problems').then(({ ok, data }) => { if (ok) setProblems(data.problems || []); });
  }, [reload]);

  const del = async (id, title) => {
    if (!window.confirm(`Delete "${title}"? This cannot be undone.`)) return;
    const res = await authFetch(`/api/v1/problems/${id}`, { method: 'DELETE' });
    if (res.ok || res.status === 204) setReload((r) => r + 1);
  };

  return (
    <div className="admin-tab-content cf-anim-fade-in">
      <h2 className="admin-section-title">Problems ({problems.length})</h2>
      <div className="monitor-table-wrapper cf-surface">
        <table className="admin-table">
          <thead><tr><th>Title</th><th>Mode</th><th>Checker</th><th>Cases</th><th></th></tr></thead>
          <tbody>
            {problems.map((p) => (
              <tr key={p._id}>
                <td>{p.title}</td>
                <td>{p.mode || 'practice'}</td>
                <td>{p.checkerType}</td>
                <td>{p.testCases?.length ?? '—'}</td>
                <td style={{ display: 'flex', gap: 6 }}>
                  <button className="cf-btn cf-btn-secondary cf-btn-sm" onClick={() => onEdit(p._id)}>Edit</button>
                  <button className="cf-btn cf-btn-danger cf-btn-sm" onClick={() => del(p._id, p.title)}>Delete</button>
                </td>
              </tr>
            ))}
            {problems.length === 0 && <tr><td colSpan="5" className="empty-state">No problems yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ContestList() {
  const [contests, setContests] = useState([]);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    authFetch('/api/v1/contests').then(({ ok, data }) => { if (ok) setContests(data.contests || []); });
  }, []);

  const act = async (id, path, label) => {
    setMsg(`${label}…`);
    const res = await authFetch(`/api/v1/contests/${id}/${path}`, { method: 'POST' });
    setMsg(res.ok ? `${label}: ${JSON.stringify(res.data)}` : `${label} failed: ${res.data?.error || res.status}`);
  };

  return (
    <div className="admin-tab-content cf-anim-fade-in">
      <h2 className="admin-section-title">Contests ({contests.length})</h2>
      {msg && <div className="cf-alert cf-alert-success">{msg}</div>}
      <div className="monitor-table-wrapper cf-surface">
        <table className="admin-table">
          <thead><tr><th>Title</th><th>Window</th><th>Problems</th><th></th></tr></thead>
          <tbody>
            {contests.map((c) => (
              <tr key={c._id}>
                <td>{c.title}</td>
                <td style={{ fontSize: 'var(--cf-text-xs)' }}>{new Date(c.startTime).toLocaleString()} → {new Date(c.endTime).toLocaleString()}</td>
                <td>{c.problemIds?.length ?? 0}</td>
                <td style={{ display: 'flex', gap: 6 }}>
                  <button className="cf-btn cf-btn-secondary cf-btn-sm" onClick={() => act(c._id, 'system-test', 'System test')}>System test</button>
                  <button className="cf-btn cf-btn-secondary cf-btn-sm" onClick={() => act(c._id, 'rebuild-standings', 'Rebuild standings')}>Rebuild standings</button>
                </td>
              </tr>
            ))}
            {contests.length === 0 && <tr><td colSpan="4" className="empty-state">No contests yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function Admin() {
  const { isAdmin } = useAuth();
  const [activeTab, setActiveTab] = useState('problems');
  const [editingProblem, setEditingProblem] = useState(null);

  if (!isAdmin) {
    return <Navigate to="/problems" replace />;
  }

  const openEditor = async (id) => {
    const res = await authFetch(`/api/v1/problems/${id}`);
    if (res.ok) { setEditingProblem(res.data.problem); setActiveTab('problem'); }
  };

  const TABS = [
    ['problems', 'Problems'],
    ['problem', editingProblem ? 'Edit Problem' : 'New Problem'],
    ['contests', 'Contests'],
    ['contest', 'New Contest'],
    ['monitor', 'Submission Monitor'],
  ];

  return (
    <div className="admin-page cf-max-width">
      <div className="admin-header">
        <h1>Admin Dashboard</h1>
      </div>

      <div className="admin-layout">
        <div className="admin-sidebar cf-panel">
          <nav className="admin-nav">
            {TABS.map(([key, label]) => (
              <button
                key={key}
                className={`admin-nav-item ${activeTab === key ? 'active' : ''}`}
                onClick={() => { setActiveTab(key); if (key !== 'problem') setEditingProblem(null); }}
              >
                {label}
              </button>
            ))}
          </nav>
        </div>

        <div className="admin-content cf-panel">
          {activeTab === 'problems' && <ProblemList onEdit={openEditor} />}
          {activeTab === 'problem' && <ProblemEditor editing={editingProblem} onSaved={() => setActiveTab('problems')} />}
          {activeTab === 'contests' && <ContestList />}
          {activeTab === 'contest' && <ContestManager />}
          {activeTab === 'monitor' && <SubmissionMonitor />}
        </div>
      </div>
    </div>
  );
}
