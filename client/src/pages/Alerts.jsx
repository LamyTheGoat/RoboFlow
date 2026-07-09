import { useState } from 'react';
import { api } from '../api.js';
import { Badge, ALERT_SEVERITY, timeAgo } from '../ui.jsx';

const SEVERITIES = ['all', 'critical', 'serious', 'warning', 'info'];

export function Alerts({ state }) {
  const { alerts, now } = state;
  const [filter, setFilter] = useState('all');
  const [hideAcked, setHideAcked] = useState(true);

  const visible = alerts
    .filter((a) => filter === 'all' || a.severity === filter)
    .filter((a) => !hideAcked || !a.acknowledged);

  return (
    <>
      <div className="page-head">
        <h1>Alerts</h1>
        <span className="sub">{alerts.filter((a) => !a.acknowledged).length} open · {alerts.filter((a) => a.acknowledged).length} acknowledged</span>
      </div>

      <div className="filters">
        {SEVERITIES.map((s) => (
          <button key={s} className={`chip${filter === s ? ' active' : ''}`} onClick={() => setFilter(s)}>
            {s === 'all' ? 'All' : ALERT_SEVERITY[s].label} ({s === 'all' ? alerts.length : alerts.filter((a) => a.severity === s).length})
          </button>
        ))}
        <button className={`chip${hideAcked ? ' active' : ''}`} onClick={() => setHideAcked(!hideAcked)}>
          Hide acknowledged
        </button>
      </div>

      <div className="grid" style={{ gap: 8 }}>
        {visible.length === 0 && <div className="card empty">No alerts match this filter.</div>}
        {visible.map((a) => (
          <div key={a.id} className={`alert-item ${a.acknowledged ? 'acked' : `unacked sev-${a.severity}`}`}>
            <Badge meta={ALERT_SEVERITY[a.severity]} />
            <div className="alert-msg">
              {a.message}
              <div className="src">{a.source} · {timeAgo(a.ts, now)}</div>
            </div>
            {a.acknowledged
              ? <span className="muted" style={{ fontSize: 12 }}>✓ acknowledged</span>
              : <button className="btn" onClick={() => api.ackAlert(a.id).catch(() => {})}>Acknowledge</button>}
          </div>
        ))}
      </div>
    </>
  );
}
