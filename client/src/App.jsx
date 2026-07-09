import { useEffect, useState } from 'react';
import { useLiveState } from './useLiveState.js';
import { api } from './api.js';
import { fmtClock } from './ui.jsx';
import { Login } from './Login.jsx';
import { Overview } from './pages/Overview.jsx';
import { Factory } from './pages/Factory.jsx';
import { Stations } from './pages/Stations.jsx';
import { Orders } from './pages/Orders.jsx';
import { Workflows } from './pages/Workflows.jsx';
import { Projects } from './pages/Projects.jsx';
import { Warehouse } from './pages/Warehouse.jsx';
import { Alerts } from './pages/Alerts.jsx';
import { Settings } from './pages/Settings.jsx';

const PAGES = [
  { id: 'overview', label: 'Overview', icon: '▦' },
  { id: 'factory', label: 'Factory', icon: '⊞' },
  { id: 'stations', label: 'Stations', icon: '⚙' },
  { id: 'orders', label: 'Orders', icon: '≣' },
  { id: 'workflows', label: 'Design studio', icon: '✎' },
  { id: 'projects', label: 'Projects', icon: '◫' },
  { id: 'warehouse', label: 'Warehouse', icon: '▤' },
  { id: 'alerts', label: 'Alerts', icon: '⚠' },
  { id: 'settings', label: 'Settings', icon: '⛭' },
];

export default function App() {
  const [user, setUser] = useState(undefined); // undefined = checking, null = login needed
  useEffect(() => {
    api.me().then(setUser).catch(() => setUser(null));
  }, []);

  if (user === undefined) {
    return <div className="app" style={{ placeItems: 'center', display: 'grid' }}>Checking session…</div>;
  }
  if (!user) return <Login onLogin={setUser} />;
  return <ControlRoom user={user} onLogout={async () => { await api.logout().catch(() => {}); setUser(null); }} />;
}

function ControlRoom({ user, onLogout }) {
  const { state, connected } = useLiveState();
  const [page, setPage] = useState(() => location.hash.slice(1) || 'overview');
  const [clock, setClock] = useState(Date.now());

  useEffect(() => {
    const t = setInterval(() => setClock(Date.now()), 1000);
    const onHash = () => setPage(location.hash.slice(1) || 'overview');
    window.addEventListener('hashchange', onHash);
    return () => {
      clearInterval(t);
      window.removeEventListener('hashchange', onHash);
    };
  }, []);

  function goTo(p) {
    setPage(p);
    location.hash = p;
  }

  if (!state) {
    return <div className="app" style={{ placeItems: 'center', display: 'grid' }}>Connecting to plant…</div>;
  }

  const openAlerts = state.alerts.filter((a) => !a.acknowledged).length;
  const counts = {
    stations: state.stations.filter((s) => s.status === 'running').length,
    orders: state.orders.filter((o) => o.status !== 'completed' && o.status !== 'cancelled').length,
    alerts: openAlerts,
  };

  function estop() {
    if (window.confirm('EMERGENCY STOP: halt every station on the floor?')) {
      api.emergencyStop().catch(() => {});
    }
  }

  const Page = {
    overview: Overview, factory: Factory, stations: Stations, orders: Orders,
    workflows: Workflows, projects: Projects, warehouse: Warehouse, alerts: Alerts,
    settings: Settings,
  }[page] ?? Overview;

  return (
    <div className="app">
      <div className="brand"><span className="brand-mark">⚙</span> RoboFlow</div>
      <header className="topbar">
        <span className="topbar-title">{state.factory.name} · {state.factory.location}</span>
        {state.factory.simulator && <span className="badge tone-accent"><span className="badge-icon">◉</span>Simulator feed</span>}
        <span className="topbar-spacer" />
        <span className="conn">
          <span className={`conn-dot${connected ? '' : ' off'}`} />
          {connected ? 'Live' : 'Reconnecting…'}
        </span>
        <span className="clock">{fmtClock(clock)}</span>
        <span className="badge tone-neutral" title={`Role: ${user.role}`}>
          <span className="badge-icon">{user.role === 'manager' ? '👑' : '🔧'}</span>{user.username}
        </span>
        <button className="btn" style={{ padding: '3px 10px' }} onClick={onLogout}>Sign out</button>
      </header>

      <nav className="sidebar">
        {PAGES.map((p) => (
          <button key={p.id} className={`nav-btn${page === p.id ? ' active' : ''}`} onClick={() => goTo(p.id)}>
            <span aria-hidden>{p.icon}</span> {p.label}
            {p.id in counts && (
              <span className={`nav-count${p.id === 'alerts' && openAlerts > 0 ? ' hot' : ''}`}>{counts[p.id]}</span>
            )}
          </button>
        ))}
        <button className="estop" onClick={estop} title="Halt every station immediately">⛔ EMERGENCY STOP</button>
      </nav>

      <main className="main">
        <Page state={state} goTo={goTo} user={user} />
      </main>
    </div>
  );
}
