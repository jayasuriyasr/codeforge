import { useRef, useState } from 'react';
import Shell from '../components/Shell.jsx';
import { useProfile } from '../hooks/useProfile.js';
import { setName, resetProfile, exportProfile, importProfile } from '../lib/profile.js';
import './Me.css';

export default function Me() {
  const profile = useProfile();
  const [draftName, setDraftName] = useState(profile.name);
  const fileRef = useRef(null);
  const [msg, setMsg] = useState('');

  function save(e) {
    e.preventDefault();
    setName(draftName);
    setMsg('Saved.');
    setTimeout(() => setMsg(''), 1500);
  }

  function download() {
    const blob = new Blob([exportProfile()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'codeforge-profile.json';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function onImport(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    f.text().then((t) => {
      setMsg(importProfile(t) ? 'Imported.' : 'That doesn’t look like a profile file.');
      setDraftName(profile.name);
      setTimeout(() => setMsg(''), 2500);
    });
  }

  return (
    <Shell>
      <h1 className="me-h1">Your profile</h1>
      <p className="me-lede">
        There are no accounts. Everything — your name, your solved list, your code drafts — lives
        only in this browser’s storage. Export it to move to another device.
      </p>

      {msg && <div className="me-msg">{msg}</div>}

      <form className="me-card" onSubmit={save}>
        <label>Display name</label>
        <div className="me-row">
          <input value={draftName} onChange={(e) => setDraftName(e.target.value)} placeholder="e.g. ada" maxLength={40} />
          <button className="btn-primary" type="submit">Save</button>
        </div>
      </form>

      <div className="me-card">
        <div className="me-stat"><b>{profile.solved.length}</b> problem{profile.solved.length === 1 ? '' : 's'} solved</div>
        {profile.solved.length > 0 && (
          <ul className="me-solved">{profile.solved.map((s) => <li key={s}>{s}</li>)}</ul>
        )}
      </div>

      <div className="me-card">
        <label>Backup &amp; restore</label>
        <div className="me-row">
          <button className="btn-ghost" onClick={download} type="button">Export profile</button>
          <button className="btn-ghost" onClick={() => fileRef.current?.click()} type="button">Import profile</button>
          <input ref={fileRef} type="file" accept="application/json" hidden onChange={onImport} />
        </div>
      </div>

      <div className="me-card me-danger">
        <label>Reset</label>
        <p>Clears your name, solved list and all code drafts from this browser.</p>
        <button className="btn-ghost" type="button" onClick={() => { if (confirm('Erase everything stored in this browser?')) resetProfile(); }}>
          Erase local data
        </button>
      </div>
    </Shell>
  );
}
