import { useState } from 'react';
import { api } from '../api.js';
import { Badge, Bar, STATION_STATUS, ROBOT_STATUS, timeAgo, typeById } from '../ui.jsx';

export function Stations({ state }) {
  const { stations, robots, orders, now } = state;
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  async function command(stationId, action) {
    setBusy(stationId + action);
    setError(null);
    try {
      await api.stationCommand(stationId, action);
    } catch (err) {
      setError(`${action} failed: ${err.message}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <div className="page-head">
        <h1>Stations & robots</h1>
        <span className="sub">{stations.length} workstations · {robots.length} robots</span>
        {error && <span className="ink-critical" style={{ fontSize: 13 }}>{error}</span>}
      </div>

      <div className="grid cols-2">
        {stations.map((s) => {
          const order = orders.find((o) => o.id === s.currentOrderId);
          const crew = robots.filter((r) => r.stationId === s.id);
          return (
            <div key={s.id} className="card station-card">
              <div className="station-head">
                <h3>{s.name}</h3>
                <span className="station-stage">
                  {typeById(state, s.typeId)?.icon} {typeById(state, s.typeId)?.name}
                  {typeById(state, s.typeId)?.composite ? ' (multi-cell)' : ''}
                </span>
                <Badge meta={STATION_STATUS[s.status]} />
              </div>

              {order ? (
                <>
                  <div className="station-order">
                    <span>{order.code} — {order.qty} units for {order.customer}</span>
                    <span className="mono">{Math.round(s.progress)}%</span>
                  </div>
                  <Bar value={s.progress} max={100} tone={s.status === 'fault' ? 'critical' : s.status === 'paused' ? 'warning' : 'accent'} />
                </>
              ) : (
                <div className="station-order muted">No batch assigned — {s.unitsToday} units processed today</div>
              )}

              {crew.map((r) => (
                <div key={r.id} className="robot-row">
                  <Badge meta={ROBOT_STATUS[r.status]}>{r.name}</Badge>
                  <span className="muted">{r.model}</span>
                  <span className="meta">{r.temperatureC}°C · wear {Math.round(r.toolWearPct)}% · seen {timeAgo(r.lastSeen, now)}</span>
                </div>
              ))}

              {Object.entries(s.actualByType ?? {}).map(([tid, rec]) => {
                const drifting = rec.planned > 0 && rec.n >= 3 && rec.ema / rec.planned >= 1.3;
                return (
                  <div key={tid} className="pace-row">
                    <span>⏱ {typeById(state, tid)?.icon} {typeById(state, tid)?.name}:</span>
                    <span className="muted">planned {rec.planned}s</span>
                    <span>→</span>
                    <span className={drifting ? 'drift' : undefined}>
                      measured {rec.ema}s/unit {drifting ? '⚠ slow' : ''}
                    </span>
                    <span className="muted">({rec.n} batch{rec.n === 1 ? '' : 'es'})</span>
                  </div>
                );
              })}

              <div className="cmd-row">
                <button className="btn btn-primary" disabled={busy != null || s.status === 'running' || s.status === 'fault'}
                  onClick={() => command(s.id, 'start')}>▶ Start</button>
                <button className="btn" disabled={busy != null || s.status !== 'running'}
                  onClick={() => command(s.id, 'pause')}>⏸ Pause</button>
                <button className="btn" disabled={busy != null || s.status === 'stopped' || s.status === 'fault'}
                  onClick={() => command(s.id, 'stop')}>■ Stop</button>
                {s.status === 'fault' && (
                  <button className="btn btn-danger" disabled={busy != null}
                    onClick={() => command(s.id, 'reset_fault')}>Reset fault</button>
                )}
                <span className="muted" style={{ marginLeft: 'auto', fontSize: 12, alignSelf: 'center' }}>
                  util {Math.round(s.utilization)}%
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
