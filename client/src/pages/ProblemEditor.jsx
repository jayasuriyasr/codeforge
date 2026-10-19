import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import Shell from '../components/Shell.jsx';
import { useAuth } from '../hooks/useAuth.js';
import { loadProblemById, saveProblem } from '../lib/problems.js';
import { renderMarkdown } from '../lib/md.js';
import {
  emptyForm, emptyTestCase, formFromProblem, slugify, validateForm, toPayload, LIMITS,
} from '../lib/problemForm.js';
import './Admin.css';

const STATEMENT_TEMPLATE = `Describe the task here. Use \`code\` for variables and **bold** for emphasis.

### Input
Line 1: \`n\`
Line 2: \`n\` space-separated integers

### Output
What the program must print.

### Constraints
- \`1 <= n <= 10^5\`
`;

// Create (/admin/new) or edit (/admin/edit/:id) a problem the admin owns.
export default function ProblemEditor() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const editing = Boolean(id);

  const [form, setForm] = useState(() => (editing ? null : { ...emptyForm(), statement: STATEMENT_TEMPLATE }));
  const [slugTouched, setSlugTouched] = useState(editing);
  const [loadErr, setLoadErr] = useState('');
  const [errors, setErrors] = useState([]);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState(false);

  useEffect(() => {
    if (!editing) return;
    loadProblemById(id)
      .then((p) => {
        if (p.createdBy !== user.id) throw new Error('You can only edit problems you created.');
        setForm(formFromProblem(p));
      })
      .catch((e) => setLoadErr(e.message));
  }, [editing, id, user.id]);

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  function setTitle(title) {
    set(slugTouched ? { title } : { title, slug: slugify(title) });
  }

  function setCase(i, patch) {
    setForm((f) => ({ ...f, testCases: f.testCases.map((c, j) => (j === i ? { ...c, ...patch } : c)) }));
  }
  function addCase() {
    setForm((f) => ({ ...f, testCases: [...f.testCases, emptyTestCase(false)] }));
  }
  function removeCase(i) {
    setForm((f) => ({ ...f, testCases: f.testCases.filter((_, j) => j !== i) }));
  }
  function moveCase(i, dir) {
    setForm((f) => {
      const next = [...f.testCases];
      const j = i + dir;
      if (j < 0 || j >= next.length) return f;
      [next[i], next[j]] = [next[j], next[i]];
      return { ...f, testCases: next };
    });
  }

  async function save(e) {
    e.preventDefault();
    const errs = validateForm(form);
    setErrors(errs);
    if (errs.length) { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    setSaving(true);
    try {
      await saveProblem(toPayload(form));
      navigate('/admin', {
        state: { flash: `Saved “${form.title.trim()}”${form.published ? ' — it is live for everyone.' : ' as a draft.'}` },
      });
    } catch (e2) {
      setErrors([e2.message]);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally {
      setSaving(false);
    }
  }

  if (loadErr) {
    return <Shell><div className="notice notice--error">{loadErr}</div><p className="admin-gap"><Link to="/admin">← My problems</Link></p></Shell>;
  }
  if (!form) return <Shell><div className="cat-loading">Loading…</div></Shell>;

  const sampleCount = form.testCases.filter((c) => c.sample).length;

  return (
    <Shell>
      <Link to="/admin" className="solve-back">← My problems</Link>
      <h1 className="page-h1 admin-gap-sm">{editing ? 'Edit problem' : 'New problem'}</h1>
      <p className="page-lede">
        Solvers see the description and the <b>sample</b> test cases. Every test case — samples and the rest — is used
        when they click Judge.
      </p>

      {errors.length > 0 && (
        <div className="notice notice--error admin-gap">
          {errors.length === 1 ? errors[0] : <>Please fix these:<ul>{errors.map((m) => <li key={m}>{m}</li>)}</ul></>}
        </div>
      )}

      <form onSubmit={save} className="editor">
        <section className="card editor-section">
          <h2>Basics</h2>
          <div className="editor-grid">
            <label className="field editor-wide">
              <span>Title</span>
              <input value={form.title} onChange={(e) => setTitle(e.target.value)} maxLength={LIMITS.title} placeholder="e.g. Two Sum" />
            </label>
            <label className="field">
              <span>URL slug</span>
              <input value={form.slug} onChange={(e) => { setSlugTouched(true); set({ slug: e.target.value.toLowerCase() }); }} placeholder="two-sum" />
              <small>The problem’s address: /p/{form.slug || 'your-slug'}</small>
            </label>
            <label className="field">
              <span>Difficulty</span>
              <select value={form.difficulty} onChange={(e) => set({ difficulty: e.target.value })}>
                <option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option>
              </select>
            </label>
            <label className="field">
              <span>Tags</span>
              <input value={form.tags} onChange={(e) => set({ tags: e.target.value })} placeholder="array, hash map" />
              <small>Comma-separated.</small>
            </label>
            <label className="field">
              <span>Time limit (seconds, per test case)</span>
              <input type="number" step="0.5" min={LIMITS.timeSec[0]} max={LIMITS.timeSec[1]} value={form.timeLimitSec}
                onChange={(e) => set({ timeLimitSec: e.target.value })} />
            </label>
            <label className="field">
              <span>Memory limit (MB)</span>
              <input type="number" step="1" min={LIMITS.memoryMB[0]} max={LIMITS.memoryMB[1]} value={form.memoryLimitMB}
                onChange={(e) => set({ memoryLimitMB: e.target.value })} />
            </label>
            <label className="field">
              <span>Output check</span>
              <select value={form.checkerType} onChange={(e) => set({ checkerType: e.target.value })}>
                <option value="exact">Exact match (ignores trailing spaces)</option>
                <option value="float">Numbers with tolerance (1e-6)</option>
              </select>
            </label>
          </div>
        </section>

        <section className="card editor-section">
          <div className="editor-section-h">
            <h2>Description</h2>
            <div className="editor-toggle">
              <button type="button" className={!preview ? 'on' : ''} onClick={() => setPreview(false)}>Write</button>
              <button type="button" className={preview ? 'on' : ''} onClick={() => setPreview(true)}>Preview</button>
            </div>
          </div>
          {preview ? (
            <article className="solve-md editor-preview" dangerouslySetInnerHTML={{ __html: renderMarkdown(form.statement) }} />
          ) : (
            <label className="field">
              <textarea rows={14} value={form.statement} onChange={(e) => set({ statement: e.target.value })} maxLength={LIMITS.statement} />
              <small>Markdown: ### headings, `code`, **bold**, *italic*, - lists, ``` code blocks.</small>
            </label>
          )}
        </section>

        <section className="card editor-section">
          <div className="editor-section-h">
            <h2>Test cases <span className="editor-count">{form.testCases.length} total · {sampleCount} sample</span></h2>
          </div>
          <p className="editor-hint">
            The expected output is compared with what the solution prints (trailing spaces and blank lines are ignored).
          </p>
          <div className="editor-cases">
            {form.testCases.map((c, i) => (
              <div key={i} className={`editor-case ${c.sample ? 'is-sample' : ''}`}>
                <div className="editor-case-h">
                  <b>Test case {i + 1}</b>
                  <label className="editor-check">
                    <input type="checkbox" checked={c.sample} onChange={(e) => setCase(i, { sample: e.target.checked })} />
                    Sample (shown to solvers)
                  </label>
                  <span className="editor-case-tools">
                    <button type="button" className="btn-ghost btn-sm" onClick={() => moveCase(i, -1)} disabled={i === 0} aria-label="Move up">↑</button>
                    <button type="button" className="btn-ghost btn-sm" onClick={() => moveCase(i, 1)} disabled={i === form.testCases.length - 1} aria-label="Move down">↓</button>
                    <button type="button" className="btn-danger btn-sm" onClick={() => removeCase(i)} disabled={form.testCases.length === 1}>Remove</button>
                  </span>
                </div>
                <div className="editor-case-io">
                  <label className="field">
                    <span>Input</span>
                    <textarea rows={4} value={c.input} onChange={(e) => setCase(i, { input: e.target.value })} spellCheck={false} />
                  </label>
                  <label className="field">
                    <span>Expected output</span>
                    <textarea rows={4} value={c.expectedOutput} onChange={(e) => setCase(i, { expectedOutput: e.target.value })} spellCheck={false} />
                  </label>
                </div>
              </div>
            ))}
          </div>
          <button type="button" className="btn-ghost" onClick={addCase} disabled={form.testCases.length >= LIMITS.maxCases}>+ Add test case</button>
        </section>

        <section className="card editor-section editor-submit">
          <label className="editor-check editor-publish">
            <input type="checkbox" checked={form.published} onChange={(e) => set({ published: e.target.checked })} />
            <span><b>Publish</b> — visible to everyone. Leave unticked to keep it as a draft only you can see.</span>
          </label>
          <div className="editor-buttons">
            <Link to="/admin" className="btn-ghost">Cancel</Link>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? 'Saving…' : form.published ? 'Save & publish' : 'Save draft'}
            </button>
          </div>
        </section>
      </form>
    </Shell>
  );
}
