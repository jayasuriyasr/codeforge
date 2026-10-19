import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import Shell from '../components/Shell.jsx';
import { useAuth } from '../hooks/useAuth.js';
import { loadMyProblems, setPublished, deleteProblem } from '../lib/problems.js';
import './Admin.css';

// The admin's own problems. Built-in problems and other admins' problems never
// appear here, and the database refuses edits to them anyway.
export default function AdminProblems() {
  const { user } = useAuth();
  const flash = useLocation().state?.flash;
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState('');
  const [busyId, setBusyId] = useState(null);

  const reload = useCallback(() => {
    loadMyProblems(user.id).then(setRows).catch((e) => setErr(e.message));
  }, [user.id]);

  useEffect(reload, [reload]);

  async function act(p, fn) {
    setErr(''); setBusyId(p.id);
    try { await fn(); reload(); } catch (e) { setErr(e.message); } finally { setBusyId(null); }
  }

  function remove(p) {
    if (!confirm(`Delete “${p.title}”? Its test cases and everyone's submissions for it are deleted too. This can't be undone.`)) return;
    act(p, () => deleteProblem(p.id));
  }

  return (
    <Shell>
      <div className="admin-head">
        <div>
          <h1 className="page-h1">My problems</h1>
          <p className="page-lede">Problems you create. Drafts are visible only to you until you publish them.</p>
        </div>
        <Link to="/admin/new" className="btn-primary">+ New problem</Link>
      </div>

      {flash && <div className="notice notice--ok admin-gap">{flash}</div>}
      {err && <div className="notice notice--error admin-gap">{err}</div>}

      {!rows && !err && <div className="cat-loading">Loading…</div>}
      {rows && rows.length === 0 && (
        <div className="card admin-empty">
          <p>You haven’t created any problems yet.</p>
          <Link to="/admin/new" className="btn-primary">Create your first problem</Link>
        </div>
      )}

      {rows && rows.length > 0 && (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr><th>Problem</th><th>Status</th><th>Difficulty</th><th>Tests</th><th>Updated</th><th /></tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id}>
                  <td>
                    <Link to={`/p/${p.slug}`} className="admin-title">{p.title}</Link>
                    <div className="admin-slug">/p/{p.slug}</div>
                  </td>
                  <td>{p.published ? <span className="pill pill--ok">published</span> : <span className="pill pill--draft">draft</span>}</td>
                  <td><span className={`cat-diff cat-diff--${p.difficulty}`}>{p.difficulty}</span></td>
                  <td className="admin-num">{p.caseCount}</td>
                  <td className="admin-num">{new Date(p.updatedAt).toLocaleDateString()}</td>
                  <td>
                    <div className="admin-actions">
                      <Link to={`/admin/edit/${p.id}`} className="btn-ghost btn-sm">Edit</Link>
                      <button className="btn-ghost btn-sm" disabled={busyId === p.id}
                        onClick={() => act(p, () => setPublished(p.id, !p.published))}>
                        {p.published ? 'Unpublish' : 'Publish'}
                      </button>
                      <button className="btn-danger btn-sm" disabled={busyId === p.id} onClick={() => remove(p)}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Shell>
  );
}
