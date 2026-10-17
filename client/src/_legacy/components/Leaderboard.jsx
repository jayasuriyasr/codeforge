import React, { useState, useEffect } from 'react';
import { apiFetch } from '../api/client';
import './Leaderboard.css';

export default function Leaderboard({ contestId }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    const url = contestId
      ? `/api/v1/leaderboard?contestId=${encodeURIComponent(contestId)}`
      : '/api/v1/leaderboard';

    const fetchIt = async () => {
      const res = await apiFetch(url);
      if (mounted && res.ok && res.data) {
        setRows(res.data.leaderboard || []);
        setLoading(false);
      } else if (mounted) {
        setLoading(false);
      }
    };
    fetchIt();
    const interval = setInterval(fetchIt, 5000);
    return () => { mounted = false; clearInterval(interval); };
  }, [contestId]);

  if (loading) {
    return <div className="cf-anim-pulse loading-leaderboard">Loading standings…</div>;
  }

  return (
    <div className="cf-panel leaderboard-panel cf-anim-fade-up">
      <h3 className="leaderboard-title">{contestId ? 'Standings' : 'Global Leaderboard'}</h3>
      <div className="leaderboard-table-wrapper">
        <table className="leaderboard-table">
          <thead>
            <tr>
              <th>Rank</th>
              <th>Participant</th>
              <th>Solved</th>
              {contestId && <th>Penalty</th>}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={contestId ? 4 : 3} className="empty-state">No submissions yet.</td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.userId}>
                  <td>{row.rank}</td>
                  <td className="user-cell">{row.name || `User ${String(row.userId).slice(-4)}`}</td>
                  <td className="score-cell">{row.solved}</td>
                  {contestId && <td className="penalty-cell">{row.penalty ?? 0}</td>}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
