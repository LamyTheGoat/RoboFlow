import { useState } from 'react';
import { api } from '../api.js';
import { Badge, Bar, timeAgo } from '../ui.jsx';

function stockMeta(item) {
  // Half products are made on the floor, not bought — an empty WIP buffer is
  // normal, so they never show reorder warnings.
  if (item.category === 'Half product') return { label: 'WIP', tone: 'accent', icon: '⟳' };
  const ratio = item.qty / item.reorderPoint;
  if (ratio <= 0.5) return { label: 'Critical', tone: 'critical', icon: '⛔' };
  if (ratio <= 1) return { label: 'Low — reorder', tone: 'warning', icon: '⚠' };
  return { label: 'OK', tone: 'good', icon: '✓' };
}

export function Warehouse({ state, user }) {
  const { inventory, events, now } = state;
  const canDesign = user?.role === 'manager';
  const [tab, setTab] = useState('all');
  const [selectedSku, setSelectedSku] = useState(null);
  const [delta, setDelta] = useState(50);
  const [showNew, setShowNew] = useState(false);
  const [newItem, setNewItem] = useState({ name: '', category: 'Raw material', unit: 'pcs', qty: 0, reorderPoint: 0, capacity: 1000 });
  const [error, setError] = useState(null);

  const low = inventory.filter((i) => i.reorderPoint > 0 && i.qty <= i.reorderPoint).length;
  const warehouseEvents = events.filter((e) => e.type === 'warehouse').slice(0, 20);
  const categories = [...new Set(inventory.map((i) => i.category))];
  const visible = inventory.filter((i) => tab === 'all' || i.category === tab);
  const selected = inventory.find((i) => i.sku === selectedSku) ?? null;

  async function run(fn) {
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <>
      <div className="page-head">
        <h1>Warehouse & stock</h1>
        <span className="sub">{inventory.length} SKUs · {low ? `${low} below reorder point` : 'all above reorder point'}</span>
        {error && <span className="ink-critical" style={{ fontSize: 13 }}>{error}</span>}
        <span style={{ flex: 1 }} />
        {canDesign && <button className="btn btn-primary" onClick={() => setShowNew(!showNew)}>+ New item</button>}
      </div>

      {showNew && (
        <form className="card form-row" style={{ marginBottom: 14 }} onSubmit={(e) => {
          e.preventDefault();
          run(async () => {
            await api.createInventoryItem(newItem);
            setShowNew(false);
            setNewItem({ ...newItem, name: '' });
          });
        }}>
          <label className="field">Name<input required value={newItem.name} onChange={(e) => setNewItem({ ...newItem, name: e.target.value })} placeholder="e.g. Rubber Seal" /></label>
          <label className="field">Category
            <select value={newItem.category} onChange={(e) => setNewItem({ ...newItem, category: e.target.value })}>
              {['Raw material', 'Consumable', 'Component', 'Packaging', 'Half product'].map((c) => <option key={c}>{c}</option>)}
            </select>
          </label>
          <label className="field">Unit<input value={newItem.unit} onChange={(e) => setNewItem({ ...newItem, unit: e.target.value })} style={{ width: 70 }} /></label>
          <label className="field">Start qty<input type="number" min="0" value={newItem.qty} onChange={(e) => setNewItem({ ...newItem, qty: Number(e.target.value) })} style={{ width: 90 }} /></label>
          <label className="field">Reorder at<input type="number" min="0" value={newItem.reorderPoint} onChange={(e) => setNewItem({ ...newItem, reorderPoint: Number(e.target.value) })} style={{ width: 90 }} /></label>
          <label className="field">Capacity<input type="number" min="10" value={newItem.capacity} onChange={(e) => setNewItem({ ...newItem, capacity: Number(e.target.value) })} style={{ width: 90 }} /></label>
          <button className="btn btn-primary" type="submit">Create</button>
        </form>
      )}

      <div className="filters">
        <button className={`chip${tab === 'all' ? ' active' : ''}`} onClick={() => setTab('all')}>All ({inventory.length})</button>
        {categories.map((c) => (
          <button key={c} className={`chip${tab === c ? ' active' : ''}`} onClick={() => setTab(c)}>
            {c === 'Half product' ? '⟳ WIP / Half products' : c} ({inventory.filter((i) => i.category === c).length})
          </button>
        ))}
      </div>

      <div className="grid cols-2" style={{ gridTemplateColumns: '3fr 2fr' }}>
        <div className="card" style={{ padding: '6px 10px' }}>
          <table>
            <thead>
              <tr><th>Material</th><th>Category</th><th style={{ width: '22%' }}>Stock level</th><th>On hand</th><th>Used today</th><th>Status</th></tr>
            </thead>
            <tbody>
              {visible.map((i) => (
                <tr key={i.sku} onClick={() => setSelectedSku(i.sku === selectedSku ? null : i.sku)}
                  style={{ cursor: 'pointer', background: i.sku === selectedSku ? 'var(--accent-soft)' : undefined }}>
                  <td>{i.name}</td>
                  <td className="muted">{i.category}</td>
                  <td><Bar value={i.qty} max={i.capacity} markerAt={i.reorderPoint > 0 ? i.reorderPoint : undefined} tone={['good', 'accent'].includes(stockMeta(i).tone) ? 'accent' : stockMeta(i).tone} /></td>
                  <td className="num">
                    {i.qty} <span className="muted">/ {i.capacity} {i.unit}</span>
                    {i.reservedQty > 0 && <div className="muted" style={{ fontSize: 10.5 }}>🔒 {i.reservedQty} reserved for orders</div>}
                  </td>
                  <td className="num muted">{i.consumedToday} {i.unit}</td>
                  <td><Badge meta={stockMeta(i)} /></td>
                </tr>
              ))}
              {visible.length === 0 && <tr><td colSpan="6" className="empty">Nothing in this category.</td></tr>}
            </tbody>
          </table>
          <div className="muted" style={{ fontSize: 11.5, padding: '8px 6px' }}>
            The tick mark on each bar is the reorder point. Click a row to manage it.
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {selected && (
            <div className="card">
              <h2>Manage — {selected.name}</h2>
              <div className="form-row" style={{ alignItems: 'end' }}>
                <label className="field">Adjust stock (±)
                  <input type="number" value={delta} onChange={(e) => setDelta(Number(e.target.value))} style={{ width: 90 }} />
                </label>
                <button className="btn btn-primary" disabled={!delta}
                  onClick={() => run(() => api.adjustStock(selected.sku, delta))}>📦 Receive / adjust</button>
                <button className="btn" disabled={!delta}
                  onClick={() => run(() => api.adjustStock(selected.sku, -Math.abs(delta)))}>− remove</button>
              </div>
              {canDesign && (
                <div className="form-row mt" style={{ alignItems: 'end' }}>
                  <label className="field">Reorder at
                    <input type="number" min="0" defaultValue={selected.reorderPoint} key={selected.sku + 'r'} id="wh-reorder" style={{ width: 90 }} />
                  </label>
                  <label className="field">Capacity
                    <input type="number" min="10" defaultValue={selected.capacity} key={selected.sku + 'c'} id="wh-capacity" style={{ width: 90 }} />
                  </label>
                  <button className="btn" onClick={() => run(() => api.updateInventoryItem(selected.sku, {
                    reorderPoint: Number(document.getElementById('wh-reorder').value),
                    capacity: Number(document.getElementById('wh-capacity').value),
                  }))}>Save settings</button>
                  <button className="btn btn-danger" onClick={() =>
                    window.confirm(`Delete ${selected.name} from the catalog?`) &&
                    run(async () => { await api.deleteInventoryItem(selected.sku); setSelectedSku(null); })
                  }>Delete</button>
                </div>
              )}
            </div>
          )}

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
      </div>
    </>
  );
}
