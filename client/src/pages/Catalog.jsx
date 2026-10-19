import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import Shell from '../components/Shell.jsx';
import { loadIndex } from '../lib/problems.js';
import { useSolved } from '../hooks/useSolved.js';
import './Catalog.css';

const DIFF_LABEL = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };

export default function Catalog() {
  const [problems, setProblems] = useState(null);
  const [err, setErr] = useState('');
  const [q, setQ] = useState('');
  const [diff, setDiff] = useState('all');
  const isSolved = useSolved();

  useEffect(() => {
    loadIndex().then(setProblems).catch((e) => setErr(e.message));
  }, []);

  const shown = useMemo(() => {
    if (!problems) return [];
    const needle = q.trim().toLowerCase();
    return problems.filter((p) => {
      if (diff !== 'all' && p.difficulty !== diff) return false;
      if (!needle) return true;
      return p.title.toLowerCase().includes(needle) || (p.tags || []).some((t) => t.includes(needle));
    });
  }, [problems, q, diff]);

  return (
    <Shell>
      <header className="cat-head">
        <h1>Problems</h1>
        <p>Solve them in your browser — JavaScript, Python, C, C++ and Java all compile and run on your own machine. Log in to save your submissions and track progress.</p>
      </header>

      {err && <div className="cat-error">Couldn’t load the problem list: {err}</div>}

      <div className="cat-filters">
        <input
          className="cat-search" type="search" placeholder="Search title or tag…"
          value={q} onChange={(e) => setQ(e.target.value)}
        />
        <div className="cat-diffs">
          {['all', 'easy', 'medium', 'hard'].map((d) => (
            <button key={d} className={diff === d ? 'on' : ''} onClick={() => setDiff(d)}>
              {d === 'all' ? 'All' : DIFF_LABEL[d]}
            </button>
          ))}
        </div>
        {problems && <span className="cat-count">{shown.length} / {problems.length}</span>}
      </div>

      {!problems && !err && <div className="cat-loading">Loading…</div>}

      <ul className="cat-list">
        {shown.map((p) => (
          <li key={p.slug}>
            <Link to={`/p/${p.slug}`} className="cat-card">
              <span className={`cat-mark ${isSolved(p) ? 'is-solved' : ''}`} aria-hidden>
                {isSolved(p) ? '✓' : ''}
              </span>
              <span className="cat-title">{p.title}</span>
              <span className={`cat-diff cat-diff--${p.difficulty}`}>{DIFF_LABEL[p.difficulty]}</span>
              <span className="cat-meta">{p.timeLimitSec}s · {p.memoryLimitMB}MB · {p.caseCount} cases</span>
              <span className="cat-tags">{(p.tags || []).join(' · ')}</span>
            </Link>
          </li>
        ))}
      </ul>
      {problems && shown.length === 0 && <div className="cat-loading">No problems match.</div>}
    </Shell>
  );
}
