import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.js';
import { useProfile } from '../hooks/useProfile.js';
import { signOut } from '../lib/auth.js';
import { dbConfigured } from '../lib/supabase.js';
import './Shell.css';

export default function Shell({ children, wide }) {
  const { ready, user, profile, isAdmin } = useAuth();
  const local = useProfile();
  const navigate = useNavigate();

  async function logout() {
    await signOut();
    navigate('/');
  }

  return (
    <div className="shell">
      <header className="shell-nav">
        <Link to="/" className="shell-brand">Code<span>Forge</span></Link>
        <nav>
          <NavLink to="/" end>Problems</NavLink>
          <NavLink to="/me">
            Dashboard
            {ready && !user && local.solved.length > 0 && <span className="shell-solved">{local.solved.length}</span>}
          </NavLink>
          {isAdmin && <NavLink to="/admin">Admin</NavLink>}
        </nav>
        <div className="shell-account">
          {dbConfigured && ready && (user ? (
            <>
              <span className="shell-user" title={user.email}>
                {profile?.username}
                {isAdmin && <span className="pill pill--admin">admin</span>}
              </span>
              <button className="btn-ghost btn-sm" onClick={logout}>Log out</button>
            </>
          ) : (
            <Link to="/login" className="btn-primary btn-sm">Log in</Link>
          ))}
        </div>
      </header>
      <main className={wide ? 'shell-main shell-main--wide' : 'shell-main'}>{children}</main>
    </div>
  );
}
