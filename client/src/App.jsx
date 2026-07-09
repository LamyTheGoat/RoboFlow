import { useEffect, useState } from 'react';
import { useLiveState } from './useLiveState.js';
import { api } from './api.js';
import { fmtClock } from './ui.jsx';
import { Overview } from './pages/Overview.jsx';
import { Stations } from './pages/Stations.jsx';
import { Orders } from './pages/Orders.jsx';
import { Projects } from './pages/Projects.jsx';
import { Warehouse } from './pages/Warehouse.jsx';
import { Alerts } from './pages/Alerts.jsx';

const PAGES = [
  { id: 'overview', label: 'Overview', icon: '▦' },
  { id: 'stations', label: 'Stations', icon: '⚙' },
  { id: 'orders', label: 'Orders', icon: '≣' },
  { id: 'projects', label: 'Projects', icon: '◫' },
  { id: 'warehouse', label: 'Warehouse', icon: '▤' },
  { id: 'alerts', label: 'Alerts', icon: '⚠' },
];

export default function App() {
  const { state, connected } = useLiveState();
  const [page, setPage] = useState(() => location.hash.slice(1) || 'overview');
  const [clock, setClock] = useState(Date.now());

  useEffect(() => {
    const t = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(t);
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
    orders: state.orders.filter((o) => o.status !== 'completed').length,
    alerts: openAlerts,
  };

  function estop() {
    if (window.confirm('EMERGENCY STOP: halt every station on the floor?')) {
      api.emergencyStop().catch(() => {});
    }
  }

  const Page = { overview: Overview, stations: Stations, orders: Orders, projects: Projects, warehouse: Warehouse, alerts: Alerts }[page] ?? Overview;

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
        <Page state={state} goTo={goTo} />
      </main>
    </div>
  );
}
