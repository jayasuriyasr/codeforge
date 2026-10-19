import { Link, Navigate, useLocation } from 'react-router-dom';
import Shell from './Shell.jsx';
import { useAuth } from '../hooks/useAuth.js';

// Page-level gate for the admin section. It only hides the UI — the database
// rejects non-admin writes on its own (RLS), whatever the browser does.
export default function RequireAdmin({ children }) {
  const { ready, user, isAdmin } = useAuth();
  const location = useLocation();

  if (!ready) return <Shell><div className="cat-loading">Loading…</div></Shell>;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (!isAdmin) {
    return (
      <Shell>
        <h1 className="page-h1">Admins only</h1>
        <p className="page-lede">Your account can view and solve problems. Creating problems needs an admin account.</p>
        <Link to="/" className="btn-ghost">← Back to problems</Link>
      </Shell>
    );
  }
  return children;
}
