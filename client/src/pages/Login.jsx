import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Shell from '../components/Shell.jsx';
import { useAuth } from '../hooks/useAuth.js';
import { signIn, signUp } from '../lib/auth.js';
import { dbConfigured } from '../lib/supabase.js';
import './Login.css';

// One login for everyone. Whether the account is a user or an admin is stored
// on the account (profiles.role) — admins just see an extra "Admin" section.
export default function Login() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const from = useLocation().state?.from || '/';

  const [mode, setMode] = useState('login'); // login | signup
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [info, setInfo] = useState('');

  useEffect(() => { if (user) navigate(from, { replace: true }); }, [user, from, navigate]);

  async function submit(e) {
    e.preventDefault();
    setErr(''); setInfo('');
    if (mode === 'signup' && (username.trim().length < 2 || username.trim().length > 32)) {
      setErr('Username must be 2–32 characters.');
      return;
    }
    setBusy(true);
    try {
      if (mode === 'login') {
        await signIn(email.trim(), password);
      } else {
        const r = await signUp(email.trim(), password, username.trim());
        if (r.needsConfirmation) setInfo('Account created. Check your email to confirm it, then log in.');
      }
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  }

  function switchTo(m) { setMode(m); setErr(''); setInfo(''); }

  return (
    <Shell>
      <div className="login">
        <div className="card login-card">
          <h1 className="page-h1">{mode === 'login' ? 'Log in' : 'Create an account'}</h1>
          <p className="login-sub">
            {mode === 'login'
              ? 'Save every submission and track your progress. Admins log in here too.'
              : 'Free. Your submissions and progress are saved to your account.'}
          </p>

          {!dbConfigured && <div className="notice notice--error">Accounts aren’t available in this build (no database configured).</div>}

          <div className="login-tabs" role="tablist">
            <button role="tab" aria-selected={mode === 'login'} className={mode === 'login' ? 'on' : ''} onClick={() => switchTo('login')}>Log in</button>
            <button role="tab" aria-selected={mode === 'signup'} className={mode === 'signup' ? 'on' : ''} onClick={() => switchTo('signup')}>Sign up</button>
          </div>

          <form onSubmit={submit} className="login-form">
            {mode === 'signup' && (
              <label className="field">
                <span>Username</span>
                <input value={username} onChange={(e) => setUsername(e.target.value)} required minLength={2} maxLength={32} autoComplete="username" placeholder="e.g. ada" />
              </label>
            )}
            <label className="field">
              <span>Email</span>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
            </label>
            <label className="field">
              <span>Password</span>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
              {mode === 'signup' && <small>At least 6 characters.</small>}
            </label>

            {err && <div className="notice notice--error">{err}</div>}
            {info && <div className="notice notice--ok">{info}</div>}

            <button className="btn-primary" type="submit" disabled={busy || !dbConfigured}>
              {busy ? 'Please wait…' : mode === 'login' ? 'Log in' : 'Create account'}
            </button>
          </form>

          <p className="login-foot">
            You can also solve problems without an account — progress is then kept only in this browser.
          </p>
        </div>
      </div>
    </Shell>
  );
}
