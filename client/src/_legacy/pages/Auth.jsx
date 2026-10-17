// pages/Auth.jsx
// ── Login + Register page ─────────────────────────────────────────────────────
//
// Single page, two tabs: "Sign In" / "Register".
// On success: JWT is stored via AuthContext.login(), then redirects to /problems.
// All form feedback uses inline error states — no toast library needed.

import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { apiFetch } from '../api/client';
import { useAuth } from '../context/AuthContext';

// ── tiny sub-components ───────────────────────────────────────────────────────

function FormField({ id, label, type = 'text', value, onChange, autoComplete, placeholder }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--cf-space-2)' }}>
      <label
        htmlFor={id}
        style={{
          fontSize: 'var(--cf-text-sm)',
          fontWeight: 'var(--cf-weight-medium)',
          color: 'var(--cf-text-secondary)',
          letterSpacing: 'var(--cf-tracking-wide)',
        }}
      >
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={onChange}
        autoComplete={autoComplete}
        placeholder={placeholder}
        required
        style={{
          background: 'var(--cf-bg-input)',
          border: '1px solid var(--cf-border-base)',
          borderRadius: 'var(--cf-radius-md)',
          padding: 'var(--cf-space-3) var(--cf-space-4)',
          color: 'var(--cf-text-primary)',
          fontSize: 'var(--cf-text-base)',
          fontFamily: 'var(--cf-font-ui)',
          outline: 'none',
          width: '100%',
          transition: 'border-color var(--cf-transition-fast), box-shadow var(--cf-transition-fast)',
        }}
        onFocus={e => {
          e.target.style.borderColor = 'var(--cf-accent)';
          e.target.style.boxShadow = 'var(--cf-glow-accent)';
        }}
        onBlur={e => {
          e.target.style.borderColor = 'var(--cf-border-base)';
          e.target.style.boxShadow = 'none';
        }}
      />
    </div>
  );
}

function SubmitButton({ loading, children }) {
  return (
    <button
      type="submit"
      disabled={loading}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 'var(--cf-space-2)',
        width: '100%',
        padding: 'var(--cf-space-3) var(--cf-space-4)',
        background: loading ? 'var(--cf-accent-dim)' : 'var(--cf-accent)',
        color: '#fff',
        border: 'none',
        borderRadius: 'var(--cf-radius-md)',
        fontSize: 'var(--cf-text-base)',
        fontWeight: 'var(--cf-weight-semibold)',
        fontFamily: 'var(--cf-font-ui)',
        cursor: loading ? 'not-allowed' : 'pointer',
        transition: 'background var(--cf-transition-fast), transform var(--cf-transition-fast)',
        transform: 'translateY(0)',
        letterSpacing: 'var(--cf-tracking-wide)',
      }}
      onMouseEnter={e => { if (!loading) e.target.style.background = 'var(--cf-accent-bright)'; }}
      onMouseLeave={e => { if (!loading) e.target.style.background = 'var(--cf-accent)'; }}
      onMouseDown={e => { if (!loading) e.target.style.transform = 'translateY(1px)'; }}
      onMouseUp={e => { e.target.style.transform = 'translateY(0)'; }}
    >
      {loading && (
        <span
          className="cf-anim-spin"
          style={{
            display: 'inline-block',
            width: 16, height: 16,
            borderRadius: '50%',
            border: '2px solid rgba(255,255,255,0.3)',
            borderTopColor: '#fff',
          }}
        />
      )}
      {children}
    </button>
  );
}

function ErrorBox({ message }) {
  if (!message) return null;
  return (
    <div style={{
      background: 'var(--cf-danger-dim)',
      border: '1px solid var(--cf-danger)',
      borderRadius: 'var(--cf-radius-md)',
      padding: 'var(--cf-space-3) var(--cf-space-4)',
      color: 'var(--cf-danger)',
      fontSize: 'var(--cf-text-sm)',
      lineHeight: 'var(--cf-leading-snug)',
      animation: 'cf-fade-up var(--cf-dur-fast) var(--cf-ease-out) both',
    }}>
      {message}
    </div>
  );
}

// ── Login form ────────────────────────────────────────────────────────────────

function LoginForm({ onSuccess }) {
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [error,    setError]    = useState('');
  const [loading,  setLoading]  = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { ok, data } = await apiFetch('/api/v1/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      if (!ok) { setError(data?.error ?? 'Login failed'); return; }
      onSuccess(data.token);
    } catch {
      setError('Network error — is the server running?');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--cf-space-5)' }}>
      <ErrorBox message={error} />
      <FormField
        id="login-email"
        label="Email"
        type="email"
        value={email}
        onChange={e => setEmail(e.target.value)}
        autoComplete="email"
        placeholder="you@example.com"
      />
      <FormField
        id="login-password"
        label="Password"
        type="password"
        value={password}
        onChange={e => setPassword(e.target.value)}
        autoComplete="current-password"
        placeholder="••••••••"
      />
      <SubmitButton loading={loading}>Sign In</SubmitButton>
    </form>
  );
}

// ── Register form ─────────────────────────────────────────────────────────────

function RegisterForm({ onSuccess }) {
  const [displayName, setDisplayName] = useState('');
  const [email,       setEmail]       = useState('');
  const [password,    setPassword]    = useState('');
  const [error,       setError]       = useState('');
  const [loading,     setLoading]     = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return; }
    setLoading(true);
    try {
      const { ok, data } = await apiFetch('/api/v1/auth/register', {
        method: 'POST',
        body: JSON.stringify({ email, password, displayName }),
      });
      if (!ok) { setError(data?.error ?? 'Registration failed'); return; }
      onSuccess(data.token);
    } catch {
      setError('Network error — is the server running?');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--cf-space-5)' }}>
      <ErrorBox message={error} />
      <FormField
        id="reg-name"
        label="Display Name"
        value={displayName}
        onChange={e => setDisplayName(e.target.value)}
        autoComplete="name"
        placeholder="Your handle"
      />
      <FormField
        id="reg-email"
        label="Email"
        type="email"
        value={email}
        onChange={e => setEmail(e.target.value)}
        autoComplete="email"
        placeholder="you@example.com"
      />
      <FormField
        id="reg-password"
        label="Password"
        type="password"
        value={password}
        onChange={e => setPassword(e.target.value)}
        autoComplete="new-password"
        placeholder="8+ characters"
      />
      <SubmitButton loading={loading}>Create Account</SubmitButton>
    </form>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AuthPage() {
  const [tab, setTab] = useState('login'); // 'login' | 'register'
  const { login }     = useAuth();
  const navigate      = useNavigate();

  function onSuccess(token) {
    login(token);
    navigate('/problems');
  }

  // Tab button style helper
  const tabBtn = (id) => ({
    flex: 1,
    padding: 'var(--cf-space-3) 0',
    background: tab === id ? 'var(--cf-accent-ghost)' : 'transparent',
    color: tab === id ? 'var(--cf-accent-bright)' : 'var(--cf-text-muted)',
    border: 'none',
    borderBottom: tab === id
      ? '2px solid var(--cf-accent)'
      : '2px solid transparent',
    borderRadius: 0,
    cursor: 'pointer',
    fontSize: 'var(--cf-text-sm)',
    fontWeight: 'var(--cf-weight-semibold)',
    fontFamily: 'var(--cf-font-ui)',
    letterSpacing: 'var(--cf-tracking-wide)',
    transition: 'color var(--cf-transition-fast), border-color var(--cf-transition-fast)',
  });

  return (
    <div style={{
      minHeight: '100dvh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 'var(--cf-space-6)',
    }}>
      {/* Card */}
      <div
        className="cf-anim-fade-up"
        style={{
          width: '100%',
          maxWidth: 420,
          background: 'var(--cf-bg-raised)',
          border: '1px solid var(--cf-border-muted)',
          borderRadius: 'var(--cf-radius-xl)',
          boxShadow: 'var(--cf-shadow-xl)',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{
          padding: 'var(--cf-space-8) var(--cf-space-8) var(--cf-space-6)',
          borderBottom: '1px solid var(--cf-border-muted)',
          textAlign: 'center',
        }}>
          <Link to="/" style={{ textDecoration: 'none' }}>
            <h1 style={{
              fontSize: 'var(--cf-text-2xl)',
              fontWeight: 'var(--cf-weight-bold)',
              letterSpacing: 'var(--cf-tracking-tight)',
              color: 'var(--cf-text-bright)',
              margin: 0,
            }}>
              Code<span style={{ color: 'var(--cf-accent)' }}>Forge</span>
            </h1>
          </Link>
          <p style={{
            marginTop: 'var(--cf-space-2)',
            fontSize: 'var(--cf-text-sm)',
            color: 'var(--cf-text-muted)',
          }}>
            Competitive programming arena
          </p>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--cf-border-muted)' }}>
          <button id="tab-login"    style={tabBtn('login')}    onClick={() => setTab('login')}>Sign In</button>
          <button id="tab-register" style={tabBtn('register')} onClick={() => setTab('register')}>Register</button>
        </div>

        {/* Form body */}
        <div style={{ padding: 'var(--cf-space-8)' }}>
          {tab === 'login'
            ? <LoginForm    onSuccess={onSuccess} />
            : <RegisterForm onSuccess={onSuccess} />
          }
        </div>

        {/* Footer hint */}
        <div style={{
          padding: 'var(--cf-space-4) var(--cf-space-8)',
          borderTop: '1px solid var(--cf-border-muted)',
          textAlign: 'center',
          fontSize: 'var(--cf-text-xs)',
          color: 'var(--cf-text-muted)',
        }}>
          {tab === 'login'
            ? <>No account? <button style={{ background:'none', border:'none', color:'var(--cf-accent-bright)', cursor:'pointer', fontFamily:'inherit', fontSize:'inherit', padding:0 }} onClick={() => setTab('register')}>Register →</button></>
            : <>Have an account? <button style={{ background:'none', border:'none', color:'var(--cf-accent-bright)', cursor:'pointer', fontFamily:'inherit', fontSize:'inherit', padding:0 }} onClick={() => setTab('login')}>Sign In →</button></>
          }
        </div>
      </div>
    </div>
  );
}
