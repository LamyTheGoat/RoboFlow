import { KpiTile, Sparkline, Badge, Bar, STATION_STATUS, ALERT_SEVERITY, timeAgo, typeById } from '../ui.jsx';

export function Overview({ state, goTo }) {
  const { stations, orders, alerts, events, inventory, metrics, now } = state;
  const running = stations.filter((s) => s.status === 'running').length;
  const faulted = stations.filter((s) => s.status === 'fault').length;
  const activeOrders = orders.filter((o) => o.status === 'in_progress' || o.status === 'queued').length;
  const held = orders.filter((o) => o.status === 'on_hold').length;
  const openAlerts = alerts.filter((a) => !a.acknowledged);
  const lowStock = inventory.filter((i) => i.qty <= i.reorderPoint);

  // Last 60 minutes of throughput, gaps filled with zeroes.
  const points = [];
  const byBucket = new Map(metrics.throughputHistory.map((p) => [p.ts, p.units]));
  const start = Math.floor(now / 60000) * 60000 - 59 * 60000;
  for (let t = start; t <= start + 59 * 60000; t += 60000) points.push({ ts: t, value: byBucket.get(t) ?? 0 });

  return (
    <>
      <div className="page-head">
        <h1>Plant overview</h1>
        <span className="sub">Live status of {state.factory.name}</span>
      </div>

      <div className="grid cols-4">
        <KpiTile label="Stations running" value={`${running} / ${stations.length}`} sub={faulted ? `${faulted} in fault` : 'no faults'} tone={faulted ? 'critical' : undefined} />
        <KpiTile label="Active orders" value={activeOrders} sub={held ? `${held} on hold` : 'none on hold'} tone={held ? 'warning' : undefined} />
        <KpiTile label="Units completed today" value={metrics.unitsToday} sub="finished goods to dispatch" />
        <KpiTile label="Open alerts" value={openAlerts.length} sub={lowStock.length ? `${lowStock.length} materials low` : 'stock levels OK'} tone={openAlerts.length ? 'critical' : 'good'} />
      </div>

      <div className="grid cols-2 mt">
        <div className="card">
          <h2>Throughput — units finished per minute (last hour)</h2>
          <Sparkline points={points} formatValue={(v) => `${v} units`} />
        </div>
        <div className="card">
          <h2>Station utilization</h2>
          {stations.map((s) => (
            <div key={s.id} style={{ display: 'grid', gridTemplateColumns: '150px 1fr 42px', gap: 10, alignItems: 'center', padding: '4px 0' }}>
              <span style={{ fontSize: 12.5, color: 'var(--ink-2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.name}</span>
              <Bar value={s.utilization} max={100} />
              <span className="muted mono" style={{ fontSize: 12, textAlign: 'right' }}>{Math.round(s.utilization)}%</span>
            </div>
          ))}
        </div>
      </div>

      <div className="grid cols-2 mt">
        <div className="card">
          <h2>Stations</h2>
          <table>
            <tbody>
              {stations.map((s) => (
                <tr key={s.id} style={{ cursor: 'pointer' }} onClick={() => goTo('stations')}>
                  <td>{s.name}</td>
                  <td className="muted">{typeById(state, s.typeId)?.icon} {typeById(state, s.typeId)?.name}</td>
                  <td><Badge meta={STATION_STATUS[s.status]} /></td>
                  <td className="muted" style={{ textAlign: 'right' }}>
                    {s.currentOrderId ? `${orders.find((o) => o.id === s.currentOrderId)?.code ?? ''} · ${Math.round(s.progress)}%` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="card">
          <h2>Attention needed</h2>
          {openAlerts.length === 0 && lowStock.length === 0 && <div className="empty">All clear — nothing needs attention.</div>}
          {openAlerts.slice(0, 5).map((a) => (
            <div key={a.id} className="feed-item">
              <span className="feed-time">{timeAgo(a.ts, now)}</span>
              <Badge meta={ALERT_SEVERITY[a.severity]} />
              <span className="feed-msg">{a.message}</span>
            </div>
          ))}
          {lowStock.slice(0, 4).map((i) => (
            <div key={i.sku} className="feed-item">
              <span className="feed-time">stock</span>
              <Badge meta={ALERT_SEVERITY.warning}>Low</Badge>
              <span className="feed-msg">{i.name}: {i.qty} {i.unit} left (reorder at {i.reorderPoint})</span>
            </div>
          ))}
          {(openAlerts.length > 5) && (
            <button className="btn mt" onClick={() => goTo('alerts')}>View all {openAlerts.length} alerts</button>
          )}
        </div>
      </div>

      <div className="card mt">
        <h2>Live event feed</h2>
        <div className="feed">
          {events.slice(0, 30).map((e) => (
            <div key={e.id} className="feed-item">
              <span className="feed-time">{timeAgo(e.ts, now)}</span>
              <span className="feed-source">{e.source}</span>
              <span className="feed-msg">{e.message}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
