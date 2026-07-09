import { useState } from 'react';
import { api } from './api.js';

export function Login({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onLogin(await api.login(username, password));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <form className="card login-card" onSubmit={submit}>
        <div className="brand" style={{ border: 'none', padding: 0, marginBottom: 4 }}>
          <span className="brand-mark">⚙</span> RoboFlow
        </div>
        <div className="muted" style={{ fontSize: 13 }}>Sign in to the control room</div>
        <label className="field">Username
          <input autoFocus value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
        </label>
        <label className="field">Password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        </label>
        <button className="btn btn-primary" type="submit" disabled={busy || !username || !password}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        {error && <div className="ink-critical" style={{ fontSize: 12.5 }}>{error}</div>}
        <div className="muted" style={{ fontSize: 11.5, lineHeight: 1.5 }}>
          Roles: <b>manager</b> can design and run everything; <b>operator</b> can run the plant
          (commands, orders, alerts) but not change designs.
        </div>
      </form>
    </div>
  );
}
