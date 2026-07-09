import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Badge } from '../ui.jsx';

export function Settings({ user }) {
  const isManager = user?.role === 'manager';
  const [users, setUsers] = useState(null);
  const [pw, setPw] = useState({ current: '', next: '', again: '' });
  const [newUser, setNewUser] = useState({ username: '', role: 'operator', password: '' });
  const [msg, setMsg] = useState(null);
  const [error, setError] = useState(null);

  const refresh = () => {
    if (isManager) api.listUsers().then(setUsers).catch(() => setUsers(null));
  };
  useEffect(refresh, [isManager]);

  async function run(fn, okMsg) {
    setError(null);
    setMsg(null);
    try {
      await fn();
      setMsg(okMsg);
      refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <>
      <div className="page-head">
        <h1>Settings</h1>
        <span className="sub">Signed in as <b>{user.username}</b> ({user.role})</span>
        {msg && <span className="ink-good" style={{ fontSize: 13 }}>✓ {msg}</span>}
        {error && <span className="ink-critical" style={{ fontSize: 13 }}>{error}</span>}
      </div>

      <div className="grid cols-2">
        <div className="card">
          <h2>Change my password</h2>
          <form className="form-row" style={{ flexDirection: 'column', alignItems: 'stretch', maxWidth: 320 }}
            onSubmit={(e) => {
              e.preventDefault();
              if (pw.next !== pw.again) return setError('new passwords do not match');
              run(async () => {
                await api.changePassword(pw.current, pw.next);
                setPw({ current: '', next: '', again: '' });
              }, 'password changed');
            }}>
            <label className="field">Current password
              <input type="password" required value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} autoComplete="current-password" />
            </label>
            <label className="field">New password (min 6 chars)
              <input type="password" required minLength="6" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} autoComplete="new-password" />
            </label>
            <label className="field">New password again
              <input type="password" required value={pw.again} onChange={(e) => setPw({ ...pw, again: e.target.value })} autoComplete="new-password" />
            </label>
            <button className="btn btn-primary" type="submit">Change password</button>
          </form>
        </div>

        {isManager && (
          <div className="card">
            <h2>Users</h2>
            <table>
              <thead><tr><th>Username</th><th>Role</th><th></th></tr></thead>
              <tbody>
                {(users ?? []).map((u) => (
                  <tr key={u.username}>
                    <td style={{ fontWeight: 600 }}>{u.username}{u.username === user.username ? ' (you)' : ''}</td>
                    <td><Badge meta={{ label: u.role, tone: u.role === 'manager' ? 'accent' : 'neutral', icon: u.role === 'manager' ? '👑' : '🔧' }} /></td>
                    <td style={{ textAlign: 'right' }}>
                      {u.username !== user.username && (
                        <button className="btn btn-tiny btn-danger"
                          onClick={() => window.confirm(`Delete user "${u.username}"?`) &&
                            run(() => api.deleteUser(u.username), `user ${u.username} deleted`)}>
                          delete
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <h2 className="mt">Add user</h2>
            <form className="form-row" onSubmit={(e) => {
              e.preventDefault();
              run(async () => {
                await api.addUser(newUser);
                setNewUser({ username: '', role: 'operator', password: '' });
              }, 'user created');
            }}>
              <label className="field">Username
                <input required value={newUser.username} onChange={(e) => setNewUser({ ...newUser, username: e.target.value })} placeholder="e.g. ahmet" />
              </label>
              <label className="field">Role
                <select value={newUser.role} onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}>
                  <option value="operator">operator</option>
                  <option value="manager">manager</option>
                </select>
              </label>
              <label className="field">Password
                <input type="password" required minLength="6" value={newUser.password} onChange={(e) => setNewUser({ ...newUser, password: e.target.value })} autoComplete="new-password" />
              </label>
              <button className="btn btn-primary" type="submit">Add</button>
            </form>
            <div className="muted" style={{ fontSize: 11.5, marginTop: 10 }}>
              managers design and run everything; operators run the plant but designs are view-only.
              The last manager cannot be deleted.
            </div>
          </div>
        )}
      </div>
    </>
  );
}
