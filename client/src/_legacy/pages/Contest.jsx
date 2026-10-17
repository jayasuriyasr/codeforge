import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { authFetch } from '../api/client';
import Leaderboard from '../components/Leaderboard';
import './Contest.css';

export default function Contest() {
  const { id } = useParams();
  const [contest, setContest] = useState(null);
  const [loading, setLoading] = useState(true);
  const [timeRemaining, setTimeRemaining] = useState('');
  const [status, setStatus] = useState('upcoming');

  useEffect(() => {
    authFetch(`/api/v1/contests/${id}`).then(res => {
      if (res.ok) setContest(res.data.contest);
      setLoading(false);
    });
  }, [id]);

  useEffect(() => {
    if (!contest) return;

    const timer = setInterval(() => {
      const now = new Date();
      const start = new Date(contest.startTime);
      const end = new Date(contest.endTime);

      if (now < start) {
        setStatus('upcoming');
        setTimeRemaining(formatDiff(start - now));
      } else if (now >= start && now <= end) {
        setStatus('active');
        setTimeRemaining(formatDiff(end - now));
      } else {
        setStatus('ended');
        setTimeRemaining('Contest has ended');
      }
    }, 1000);

    // Initial call to avoid 1s delay
    const now = new Date();
    const start = new Date(contest.startTime);
    const end = new Date(contest.endTime);
    if (now < start) {
      setStatus('upcoming');
      setTimeRemaining(formatDiff(start - now));
    } else if (now >= start && now <= end) {
      setStatus('active');
      setTimeRemaining(formatDiff(end - now));
    } else {
      setStatus('ended');
      setTimeRemaining('Contest has ended');
    }

    return () => clearInterval(timer);
  }, [contest]);

  function formatDiff(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }

  if (loading) return <div className="cf-anim-pulse loading-contest">Loading contest...</div>;
  if (!contest) return <div className="error-contest">Contest not found</div>;

  return (
    <div className="contest-dashboard" style={{ maxWidth: 'var(--cf-max-width)', margin: '0 auto', padding: 'var(--cf-space-6)' }}>
      <div className="contest-header cf-panel">
        <h1 className="contest-title">{contest.title}</h1>
        <p className="contest-description">{contest.description}</p>
        <div className={`contest-timer timer-${status}`}>
          <span className="timer-label">
            {status === 'upcoming' ? 'Starts In: ' : status === 'active' ? 'Time Remaining: ' : ''}
          </span>
          <span className={`timer-value ${status === 'active' ? 'cf-anim-pulse' : ''}`}>{timeRemaining}</span>
        </div>
      </div>

      <div className="contest-body">
        <div className="contest-problems cf-surface">
          <h2 className="section-title">Problem Set</h2>
          {contest.problemIds && contest.problemIds.length > 0 ? (
            <ul className="problem-list">
              {contest.problemIds.map((probId, idx) => (
                <li key={probId} className="problem-list-item">
                  <Link to={`/problems/${probId}?contestId=${id}`} className="problem-link">
                    <span className="problem-letter">{String.fromCharCode(65 + idx)}</span>
                    <span className="problem-id">Problem {probId.toString().slice(-4)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="empty-problems">No problems added to this contest yet.</p>
          )}
        </div>

        <div className="contest-leaderboard-wrapper">
          <Leaderboard contestId={id} />
        </div>
      </div>
    </div>
  );
}
