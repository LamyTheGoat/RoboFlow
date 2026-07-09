import { useState } from 'react';
import { api } from '../api.js';
import { Badge, StagePips, ORDER_STATUS, fmtDate } from '../ui.jsx';

const FILTERS = ['all', 'in_progress', 'queued', 'on_hold', 'completed'];

export function Orders({ state }) {
  const { orders, projects, now } = state;
  const [filter, setFilter] = useState('all');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ projectId: projects[0]?.id, customer: '', qty: 10, priority: 'normal' });
  const [error, setError] = useState(null);

  const visible = orders.filter((o) => filter === 'all' || o.status === filter);

  async function submit(e) {
    e.preventDefault();
    setError(null);
    try {
      await api.createOrder(form);
      setShowForm(false);
      setForm({ ...form, customer: '', qty: 10 });
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <>
      <div className="page-head">
        <h1>Orders</h1>
        <span className="sub">{orders.filter((o) => o.status !== 'completed').length} open · {orders.filter((o) => o.status === 'completed').length} completed</span>
        <span style={{ flex: 1 }} />
        <button className="btn btn-primary" onClick={() => setShowForm(!showForm)}>+ New order</button>
      </div>

      {showForm && (
        <form className="card form-row" style={{ marginBottom: 14 }} onSubmit={submit}>
          <label className="field">Product line
            <select value={form.projectId} onChange={(e) => setForm({ ...form, projectId: e.target.value })}>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name} — {p.product}</option>)}
            </select>
          </label>
          <label className="field">Customer
            <input required value={form.customer} onChange={(e) => setForm({ ...form, customer: e.target.value })} placeholder="Customer name" />
          </label>
          <label className="field">Quantity
            <input type="number" min="1" max="500" required value={form.qty} onChange={(e) => setForm({ ...form, qty: Number(e.target.value) })} />
          </label>
          <label className="field">Priority
            <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
              <option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option>
            </select>
          </label>
          <button className="btn btn-primary" type="submit">Create order</button>
          {error && <span className="ink-critical" style={{ fontSize: 12.5 }}>{error}</span>}
        </form>
      )}

      <div className="filters">
        {FILTERS.map((f) => (
          <button key={f} className={`chip${filter === f ? ' active' : ''}`} onClick={() => setFilter(f)}>
            {f === 'all' ? 'All' : ORDER_STATUS[f].label} ({f === 'all' ? orders.length : orders.filter((o) => o.status === f).length})
          </button>
        ))}
      </div>

      <div className="card" style={{ padding: '6px 10px', overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>Order</th><th>Product</th><th>Customer</th><th>Qty</th><th>Priority</th>
              <th>Status</th><th>Workflow</th><th>Location</th><th>Due</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((o) => {
              const project = projects.find((p) => p.id === o.projectId);
              const overdue = o.status !== 'completed' && o.dueDate < now;
              return (
                <tr key={o.id}>
                  <td style={{ fontWeight: 600 }}>{o.code}</td>
                  <td className="muted">{project?.product}</td>
                  <td>{o.customer}</td>
                  <td className="num">{o.qty}</td>
                  <td>
                    <select className="chip" style={{ padding: '2px 6px' }} value={o.priority}
                      onChange={(e) => api.setPriority(o.id, e.target.value).catch(() => {})}>
                      <option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option>
                    </select>
                  </td>
                  <td><Badge meta={ORDER_STATUS[o.status]} /></td>
                  <td><StagePips stages={o.stages} /></td>
                  <td className="muted">{o.location}</td>
                  <td className={overdue ? 'ink-critical' : 'muted'}>{fmtDate(o.dueDate)}{overdue ? ' ⚠' : ''}</td>
                </tr>
              );
            })}
            {visible.length === 0 && <tr><td colSpan="9" className="empty">No orders match this filter.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
