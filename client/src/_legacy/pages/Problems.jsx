// pages/Problems.jsx
// ── Filterable problem grid ───────────────────────────────────────────────────
//
// Reads from GET /api/v1/problems (public — no auth required).
// Filters: difficulty (easy / medium / hard / all) + text search on title.
// Clicking a card navigates to /problems/:id (page built in Step 14).

import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../api/client';
import { useAuth } from '../context/AuthContext';

// ── constants ─────────────────────────────────────────────────────────────────

const DIFFICULTY_META = {
  easy:   { label: 'Easy',   chipClass: 'cf-chip--ac',   dotColor: 'var(--cf-success)' },
  medium: { label: 'Medium', chipClass: 'cf-chip--re',   dotColor: 'var(--cf-warning)' },
  hard:   { label: 'Hard',   chipClass: 'cf-chip--wa',   dotColor: 'var(--cf-danger)'  },
};

// ── sub-components ────────────────────────────────────────────────────────────

function DifficultyChip({ difficulty }) {
  if (!difficulty) return null;
  const meta = DIFFICULTY_META[difficulty] ?? { label: difficulty, chipClass: 'cf-chip--infra' };
  return <span className={`cf-chip ${meta.chipClass}`}>{meta.label}</span>;
}

function ProblemCard({ problem, index, solved }) {
  const diff   = problem.difficulty;
  const dotClr = diff ? DIFFICULTY_META[diff]?.dotColor : 'var(--cf-border-strong)';

  return (
    <Link
      to={`/problems/${problem._id}`}
      id={`problem-card-${problem._id}`}
      className="cf-anim-fade-up cf-stagger"
      style={{ '--cf-stagger-i': index % 8, textDecoration: 'none', display: 'block' }}
    >
      <article
        style={{
          background: 'var(--cf-bg-raised)',
          border: '1px solid var(--cf-border-muted)',
          borderRadius: 'var(--cf-radius-lg)',
          padding: 'var(--cf-space-5) var(--cf-space-6)',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--cf-space-3)',
          transition: 'border-color var(--cf-transition-fast), box-shadow var(--cf-transition-fast), transform var(--cf-transition-fast)',
          cursor: 'pointer',
        }}
        onMouseEnter={e => {
          e.currentTarget.style.borderColor = 'var(--cf-border-strong)';
          e.currentTarget.style.boxShadow   = 'var(--cf-shadow-md)';
          e.currentTarget.style.transform   = 'translateY(-2px)';
        }}
        onMouseLeave={e => {
          e.currentTarget.style.borderColor = 'var(--cf-border-muted)';
          e.currentTarget.style.boxShadow   = 'none';
          e.currentTarget.style.transform   = 'translateY(0)';
        }}
      >
        {/* Top row: index + difficulty chip */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{
            fontFamily: 'var(--cf-font-code)',
            fontSize: 'var(--cf-text-xs)',
            color: 'var(--cf-text-muted)',
          }}>
            {solved ? <span style={{ color: 'var(--cf-success)' }} title="solved in practice">✓ </span> : null}
            #{String(index + 1).padStart(3, '0')}
          </span>
          <DifficultyChip difficulty={diff} />
        </div>

        {/* Title */}
        <h2 style={{
          fontSize: 'var(--cf-text-md)',
          fontWeight: 'var(--cf-weight-semibold)',
          color: 'var(--cf-text-heading)',
          letterSpacing: 'var(--cf-tracking-snug)',
          lineHeight: 'var(--cf-leading-snug)',
          margin: 0,
          flex: 1,
        }}>
          {/* Colored dot indicating difficulty */}
          <span style={{
            display: 'inline-block',
            width: 7, height: 7,
            borderRadius: '50%',
            background: dotClr,
            marginRight: 'var(--cf-space-2)',
            verticalAlign: 'middle',
            flexShrink: 0,
          }} />
          {problem.title}
        </h2>

        {/* Footer: limits */}
        <div style={{
          display: 'flex',
          gap: 'var(--cf-space-4)',
          marginTop: 'auto',
          paddingTop: 'var(--cf-space-3)',
          borderTop: '1px solid var(--cf-border-muted)',
        }}>
          <Stat label="Time"   value={`${problem.timeLimitSec}s`}  />
          <Stat label="Memory" value={`${problem.memoryLimitMB}MB`} />
          {problem.checkerType && problem.checkerType !== 'exact' && (
            <Stat label="Checker" value={problem.checkerType} />
          )}
        </div>
      </article>
    </Link>
  );
}

function Stat({ label, value }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ fontSize: 'var(--cf-text-2xs)', color: 'var(--cf-text-muted)', textTransform: 'uppercase', letterSpacing: 'var(--cf-tracking-widest)' }}>
        {label}
      </span>
      <span style={{ fontFamily: 'var(--cf-font-code)', fontSize: 'var(--cf-text-xs)', color: 'var(--cf-text-secondary)' }}>
        {value}
      </span>
    </div>
  );
}

// ── Skeleton card ─────────────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div style={{
      background: 'var(--cf-bg-raised)',
      border: '1px solid var(--cf-border-muted)',
      borderRadius: 'var(--cf-radius-lg)',
      padding: 'var(--cf-space-5) var(--cf-space-6)',
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--cf-space-4)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <div className="cf-anim-shimmer" style={{ width: 36, height: 14, borderRadius: 'var(--cf-radius-sm)' }} />
        <div className="cf-anim-shimmer" style={{ width: 56, height: 18, borderRadius: 'var(--cf-radius-full)' }} />
      </div>
      <div className="cf-anim-shimmer" style={{ width: '80%', height: 18, borderRadius: 'var(--cf-radius-sm)' }} />
      <div className="cf-anim-shimmer" style={{ width: '55%', height: 14, borderRadius: 'var(--cf-radius-sm)' }} />
      <div style={{ display:'flex', gap:'var(--cf-space-4)', paddingTop:'var(--cf-space-3)', borderTop:'1px solid var(--cf-border-muted)' }}>
        <div className="cf-anim-shimmer" style={{ width: 50, height: 28, borderRadius: 'var(--cf-radius-sm)' }} />
        <div className="cf-anim-shimmer" style={{ width: 60, height: 28, borderRadius: 'var(--cf-radius-sm)' }} />
      </div>
    </div>
  );
}

// ── Filter bar ────────────────────────────────────────────────────────────────

const DIFF_FILTERS = ['all', 'easy', 'medium', 'hard'];

function FilterBar({ search, onSearch, difficulty, onDifficulty, total, shown }) {
  const btnStyle = (active) => ({
    padding: 'var(--cf-space-2) var(--cf-space-4)',
    borderRadius: 'var(--cf-radius-full)',
    border: `1px solid ${active ? 'var(--cf-accent)' : 'var(--cf-border-muted)'}`,
    background: active ? 'var(--cf-accent-ghost)' : 'transparent',
    color: active ? 'var(--cf-accent-bright)' : 'var(--cf-text-muted)',
    fontSize: 'var(--cf-text-sm)',
    fontWeight: 'var(--cf-weight-medium)',
    fontFamily: 'var(--cf-font-ui)',
    cursor: 'pointer',
    transition: 'all var(--cf-transition-fast)',
    letterSpacing: 'var(--cf-tracking-wide)',
  });

  return (
    <div style={{
      display: 'flex',
      flexWrap: 'wrap',
      gap: 'var(--cf-space-4)',
      alignItems: 'center',
      marginBottom: 'var(--cf-space-8)',
    }}>
      {/* Search */}
      <div style={{ flex: '1 1 220px', position: 'relative' }}>
        <span style={{
          position: 'absolute', left: 'var(--cf-space-3)', top: '50%', transform: 'translateY(-50%)',
          color: 'var(--cf-text-muted)', fontSize: 'var(--cf-text-sm)', pointerEvents: 'none',
        }}>⌕</span>
        <input
          id="problem-search"
          type="search"
          value={search}
          onChange={e => onSearch(e.target.value)}
          placeholder="Search problems…"
          style={{
            width: '100%',
            background: 'var(--cf-bg-input)',
            border: '1px solid var(--cf-border-base)',
            borderRadius: 'var(--cf-radius-md)',
            padding: 'var(--cf-space-3) var(--cf-space-4) var(--cf-space-3) calc(var(--cf-space-3) + 20px)',
            color: 'var(--cf-text-primary)',
            fontSize: 'var(--cf-text-sm)',
            fontFamily: 'var(--cf-font-ui)',
            outline: 'none',
            transition: 'border-color var(--cf-transition-fast)',
          }}
          onFocus={e => { e.target.style.borderColor = 'var(--cf-accent)'; }}
          onBlur={e  => { e.target.style.borderColor = 'var(--cf-border-base)'; }}
        />
      </div>

      {/* Difficulty tabs */}
      <div style={{ display: 'flex', gap: 'var(--cf-space-2)', flexWrap: 'wrap' }}>
        {DIFF_FILTERS.map(d => (
          <button
            key={d}
            id={`filter-${d}`}
            style={btnStyle(difficulty === d)}
            onClick={() => onDifficulty(d)}
          >
            {d === 'all' ? 'All' : d.charAt(0).toUpperCase() + d.slice(1)}
          </button>
        ))}
      </div>

      {/* Count */}
      <span style={{
        marginLeft: 'auto',
        fontSize: 'var(--cf-text-sm)',
        color: 'var(--cf-text-muted)',
        fontFamily: 'var(--cf-font-code)',
        whiteSpace: 'nowrap',
      }}>
        {shown} / {total}
      </span>
    </div>
  );
}

// ── Navbar strip (minimal — full navbar comes in Step 12) ─────────────────────

function Navbar() {
  const { user, logout } = useAuth();
  return (
    <nav style={{
      height: 'var(--cf-navbar-height)',
      display: 'flex',
      alignItems: 'center',
      padding: '0 var(--cf-space-8)',
      borderBottom: '1px solid var(--cf-border-muted)',
      background: 'var(--cf-bg-raised)',
      position: 'sticky',
      top: 0,
      zIndex: 'var(--cf-z-overlay)',
    }}>
      <Link to="/problems" style={{ textDecoration: 'none', fontWeight: 'var(--cf-weight-bold)', fontSize: 'var(--cf-text-lg)', color: 'var(--cf-text-bright)', letterSpacing: 'var(--cf-tracking-snug)' }}>
        Code<span style={{ color: 'var(--cf-accent)' }}>Forge</span>
      </Link>

      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 'var(--cf-space-4)' }}>
        {user && (
          <span style={{ fontSize: 'var(--cf-text-sm)', color: 'var(--cf-text-muted)' }}>
            {user.role === 'admin' && (
              <span className="cf-chip cf-chip--infra" style={{ marginRight: 'var(--cf-space-2)' }}>admin</span>
            )}
            {user.email ?? user.sub}
          </span>
        )}
        {user
          ? <button id="nav-logout" onClick={logout} style={{ background:'none', border:'1px solid var(--cf-border-base)', borderRadius:'var(--cf-radius-md)', padding:'var(--cf-space-2) var(--cf-space-3)', color:'var(--cf-text-secondary)', fontSize:'var(--cf-text-sm)', cursor:'pointer', fontFamily:'var(--cf-font-ui)' }}>Log Out</button>
          : <Link id="nav-login" to="/auth" style={{ background:'var(--cf-accent)', color:'#fff', padding:'var(--cf-space-2) var(--cf-space-4)', borderRadius:'var(--cf-radius-md)', fontSize:'var(--cf-text-sm)', fontWeight:'var(--cf-weight-semibold)', textDecoration:'none' }}>Sign In</Link>
        }
      </div>
    </nav>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ProblemsPage() {
  const { user } = useAuth();
  const [problems,   setProblems]   = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [fetchError, setFetchError] = useState('');
  const [search,     setSearch]     = useState('');
  const [difficulty, setDifficulty] = useState('all');

  const solvedSet = useMemo(() => {
    try { return new Set(JSON.parse(localStorage.getItem(`cf_practice_solved_${user?.sub}`) || '[]')); }
    catch { return new Set(); }
  }, [user?.sub]);

  // Fetch on mount
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    apiFetch('/api/v1/problems')
      .then(({ ok, data }) => {
        if (cancelled) return;
        if (!ok) { setFetchError(data?.error ?? 'Failed to load problems'); return; }
        setProblems(data.problems ?? []);
      })
      .catch(() => { if (!cancelled) setFetchError('Network error — is the server running?'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // Client-side filter
  const filtered = useMemo(() => {
    let list = problems;
    if (difficulty !== 'all') list = list.filter(p => p.difficulty === difficulty);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(p =>
        p.title.toLowerCase().includes(q) ||
        p.slug.toLowerCase().includes(q)
      );
    }
    return list;
  }, [problems, difficulty, search]);

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--cf-bg-base)' }}>
      <Navbar />

      <main style={{
        maxWidth: 'var(--cf-max-width)',
        margin: '0 auto',
        padding: 'var(--cf-space-10) var(--cf-space-6)',
      }}>
        {/* Page header */}
        <header className="cf-anim-fade-down" style={{ marginBottom: 'var(--cf-space-10)' }}>
          <h1 style={{
            fontSize: 'var(--cf-text-3xl)',
            fontWeight: 'var(--cf-weight-bold)',
            letterSpacing: 'var(--cf-tracking-tight)',
            color: 'var(--cf-text-bright)',
            margin: '0 0 var(--cf-space-3)',
          }}>
            Problem Set
          </h1>
          <p style={{ color: 'var(--cf-text-secondary)', fontSize: 'var(--cf-text-md)' }}>
            Filter by difficulty, search by title, and select a problem to compete.
          </p>
        </header>

        {/* Error */}
        {fetchError && (
          <div style={{
            background: 'var(--cf-danger-dim)',
            border: '1px solid var(--cf-danger)',
            borderRadius: 'var(--cf-radius-md)',
            padding: 'var(--cf-space-4)',
            color: 'var(--cf-danger)',
            marginBottom: 'var(--cf-space-6)',
          }}>
            {fetchError}
          </div>
        )}

        {/* Filter bar */}
        <FilterBar
          search={search}
          onSearch={setSearch}
          difficulty={difficulty}
          onDifficulty={setDifficulty}
          total={problems.length}
          shown={filtered.length}
        />

        {/* Grid */}
        {loading ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 'var(--cf-space-5)' }}>
            {Array.from({ length: 9 }, (_, i) => <SkeletonCard key={i} />)}
          </div>
        ) : filtered.length === 0 ? (
          <div style={{
            textAlign: 'center',
            padding: 'var(--cf-space-20) 0',
            color: 'var(--cf-text-muted)',
          }}>
            <p style={{ fontSize: 'var(--cf-text-2xl)', marginBottom: 'var(--cf-space-3)' }}>🔍</p>
            <p style={{ fontSize: 'var(--cf-text-lg)', color: 'var(--cf-text-secondary)' }}>
              No problems match your filters.
            </p>
            <button
              id="clear-filters"
              onClick={() => { setSearch(''); setDifficulty('all'); }}
              style={{
                marginTop: 'var(--cf-space-4)',
                background: 'none',
                border: '1px solid var(--cf-border-base)',
                borderRadius: 'var(--cf-radius-md)',
                padding: 'var(--cf-space-2) var(--cf-space-5)',
                color: 'var(--cf-text-secondary)',
                cursor: 'pointer',
                fontFamily: 'var(--cf-font-ui)',
                fontSize: 'var(--cf-text-sm)',
              }}
            >
              Clear filters
            </button>
          </div>
        ) : (
          <div
            id="problem-grid"
            style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 'var(--cf-space-5)' }}
          >
            {filtered.map((p, i) => <ProblemCard key={p._id} problem={p} index={i} solved={solvedSet.has(p._id)} />)}
          </div>
        )}
      </main>
    </div>
  );
}
