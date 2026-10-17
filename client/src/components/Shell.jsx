import { Link, NavLink } from 'react-router-dom';
import { useProfile } from '../hooks/useProfile.js';
import './Shell.css';

export default function Shell({ children, wide }) {
  const profile = useProfile();
  return (
    <div className="shell">
      <header className="shell-nav">
        <Link to="/" className="shell-brand">Code<span>Forge</span></Link>
        <nav>
          <NavLink to="/" end>Problems</NavLink>
          <NavLink to="/me">
            {profile.name ? profile.name : 'Profile'}
            {profile.solved.length > 0 && <span className="shell-solved">{profile.solved.length}</span>}
          </NavLink>
        </nav>
        <span className="shell-tag" title="Everything runs in your browser">100% client-side</span>
      </header>
      <main className={wide ? 'shell-main shell-main--wide' : 'shell-main'}>{children}</main>
    </div>
  );
}
