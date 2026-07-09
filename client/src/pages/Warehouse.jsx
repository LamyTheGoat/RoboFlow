import { Badge, Bar, timeAgo } from '../ui.jsx';

function stockMeta(item) {
  const ratio = item.qty / item.reorderPoint;
  if (ratio <= 0.5) return { label: 'Critical', tone: 'critical', icon: '⛔' };
  if (ratio <= 1) return { label: 'Low — reorder', tone: 'warning', icon: '⚠' };
  return { label: 'OK', tone: 'good', icon: '✓' };
}

export function Warehouse({ state }) {
  const { inventory, events, now } = state;
  const low = inventory.filter((i) => i.qty <= i.reorderPoint).length;
  const warehouseEvents = events.filter((e) => e.type === 'warehouse').slice(0, 20);
  const categories = [...new Set(inventory.map((i) => i.category))];

  return (
    <>
      <div className="page-head">
        <h1>Warehouse & stock</h1>
        <span className="sub">{inventory.length} SKUs · {low ? `${low} below reorder point` : 'all above reorder point'}</span>
      </div>

      <div className="grid cols-2" style={{ gridTemplateColumns: '3fr 2fr' }}>
        <div className="card" style={{ padding: '6px 10px' }}>
          <table>
            <thead>
              <tr><th>Material</th><th>Category</th><th style={{ width: '24%' }}>Stock level</th><th>On hand</th><th>Used today</th><th>Status</th></tr>
            </thead>
            <tbody>
              {categories.map((cat) => inventory.filter((i) => i.category === cat).map((i) => (
                <tr key={i.sku}>
                  <td>{i.name}</td>
                  <td className="muted">{i.category}</td>
                  <td><Bar value={i.qty} max={i.capacity} markerAt={i.reorderPoint} tone={stockMeta(i).tone === 'good' ? 'accent' : stockMeta(i).tone} /></td>
                  <td className="num">{i.qty} <span className="muted">/ {i.capacity} {i.unit}</span></td>
                  <td className="num muted">{i.consumedToday} {i.unit}</td>
                  <td><Badge meta={stockMeta(i)} /></td>
                </tr>
              )))}
            </tbody>
          </table>
          <div className="muted" style={{ fontSize: 11.5, padding: '8px 6px' }}>
            The tick mark on each bar is the reorder point.
          </div>
        </div>

        <div className="card">
          <h2>Warehouse activity</h2>
          <div className="feed">
            {warehouseEvents.length === 0 && <div className="empty">No warehouse movements yet.</div>}
            {warehouseEvents.map((e) => (
              <div key={e.id} className="feed-item">
                <span className="feed-time">{timeAgo(e.ts, now)}</span>
                <span className="feed-source">{e.source}</span>
                <span className="feed-msg">{e.message}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
