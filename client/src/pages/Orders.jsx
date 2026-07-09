import { useState } from 'react';
import { api } from '../api.js';
import { Badge, StagePips, ORDER_STATUS, fmtDate, Bar } from '../ui.jsx';

const FILTERS = ['all', 'in_progress', 'queued', 'on_hold', 'completed', 'cancelled'];

function lotStatus(batches) {
  if (batches.every((b) => b.status === 'completed')) return 'completed';
  if (batches.every((b) => b.status === 'cancelled')) return 'cancelled';
  if (batches.some((b) => b.status === 'in_progress')) return 'in_progress';
  if (batches.some((b) => b.status === 'on_hold')) return 'on_hold';
  return 'queued';
}

function ProducedCell({ pct, tone, caption }) {
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <div style={{ flex: 1 }}><Bar value={pct} max={100} tone={tone} /></div>
        <span className="mono muted" style={{ fontSize: 11.5 }}>{pct}%</span>
      </div>
      <div className="muted" style={{ fontSize: 10.5, marginTop: 2 }}>{caption}</div>
    </>
  );
}

function OrderRow({ o, state, projects, now, indent }) {
  const project = projects.find((p) => p.id === o.projectId);
  const overdue = o.status !== 'completed' && o.status !== 'cancelled' && o.dueDate < now;
  return (
    <tr style={indent ? { background: 'rgba(57,135,229,0.04)' } : undefined}>
      <td style={{ fontWeight: 600, paddingLeft: indent ? 26 : undefined }}>{o.code}</td>
      <td className="muted">{indent ? `batch ${o.lotSeq}/${o.lotCount}` : project?.product}</td>
      <td>{indent ? '' : o.customer}</td>
      <td className="num">{o.qty}</td>
      <td>
        {indent ? <span className="muted" style={{ fontSize: 11.5 }}>{o.priority}</span> : (
          <select className="chip" style={{ padding: '2px 6px' }} value={o.priority}
            onChange={(e) => api.setPriority(o.id, e.target.value).catch(() => {})}>
            <option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option>
          </select>
        )}
      </td>
      <td><Badge meta={ORDER_STATUS[o.status]} /></td>
      <td>
        {o.status === 'cancelled' ? <span className="muted">—</span> : (
          <ProducedCell pct={o.overallPct} tone={o.status === 'completed' ? 'good' : 'accent'}
            caption={o.status === 'completed'
              ? `${o.qty} / ${o.qty} units shipped`
              : o.currentStageUnitsDone != null
                ? `≈ ${o.currentStageUnitsDone} / ${o.qty} units at ${o.stages[o.stageIndex]?.name} · step ${o.stageIndex + 1}/${o.stages.length}`
                : `step ${Math.min(o.stageIndex + 1, o.stages.length)}/${o.stages.length} — waiting`} />
        )}
      </td>
      <td><StagePips stages={o.stages} /></td>
      <td className="muted">{o.location}</td>
      <td className={overdue ? 'ink-critical' : 'muted'}>{fmtDate(o.dueDate)}{overdue ? ' ⚠' : ''}</td>
      <td style={{ whiteSpace: 'nowrap' }}>
        {(o.status === 'queued' || o.status === 'on_hold') && (
          <button className="btn btn-tiny" title="Rebuild this order's routing from the project's current workflow design (progress restarts)"
            onClick={() => window.confirm(`Reroute ${o.code} to the current workflow design? Progress restarts from step 1.`) && api.rerouteOrder(o.id).catch((e) => alert(e.message))}>
            ↻ reroute
          </button>
        )}
        {o.status !== 'completed' && o.status !== 'cancelled' && (
          <button className="btn btn-tiny btn-danger" style={{ marginLeft: 4 }}
            onClick={() => window.confirm(`Cancel ${o.code}? Materials already issued stay consumed.`) && api.cancelOrder(o.id).catch((e) => alert(e.message))}>
            ✕ cancel
          </button>
        )}
      </td>
    </tr>
  );
}

function LotRow({ batches, projects, expanded, onToggle }) {
  const first = batches[0];
  const project = projects.find((p) => p.id === first.projectId);
  const baseCode = first.code.split('·')[0];
  const status = lotStatus(batches);
  const totalQty = first.lotQty ?? batches.reduce((s, b) => s + b.qty, 0);
  const live = batches.filter((b) => b.status !== 'cancelled');
  const pct = live.length
    ? Math.round(live.reduce((s, b) => s + b.overallPct * b.qty, 0) / live.reduce((s, b) => s + b.qty, 0))
    : 0;
  const shippedUnits = batches.filter((b) => b.status === 'completed').reduce((s, b) => s + b.qty, 0);
  const working = batches.filter((b) => b.status === 'in_progress').length;
  const openBatches = batches.filter((b) => b.status !== 'completed' && b.status !== 'cancelled');

  async function setLotPriority(priority) {
    for (const b of openBatches) await api.setPriority(b.id, priority).catch(() => {});
  }
  async function cancelLot() {
    if (!window.confirm(`Cancel all ${openBatches.length} remaining batches of ${baseCode}?`)) return;
    for (const b of openBatches) await api.cancelOrder(b.id).catch(() => {});
  }

  return (
    <tr style={{ cursor: 'pointer' }} onClick={onToggle}>
      <td style={{ fontWeight: 700 }}>{expanded ? '▾' : '▸'} {baseCode} <span className="badge tone-accent" style={{ fontSize: 10 }}>⇶ flow</span></td>
      <td className="muted">{project?.product}</td>
      <td>{first.customer}</td>
      <td className="num">{totalQty}</td>
      <td onClick={(e) => e.stopPropagation()}>
        <select className="chip" style={{ padding: '2px 6px' }} value={first.priority}
          onChange={(e) => setLotPriority(e.target.value)}>
          <option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option>
        </select>
      </td>
      <td><Badge meta={ORDER_STATUS[status]} /></td>
      <td>
        <ProducedCell pct={pct} tone={status === 'completed' ? 'good' : 'accent'}
          caption={`${shippedUnits} / ${totalQty} units shipped · ${batches.length} batches${working ? ` · ${working} on machines now` : ''}`} />
      </td>
      <td className="muted" style={{ fontSize: 11.5 }}>pipeline of {batches.length} batches — expand for detail</td>
      <td className="muted" style={{ fontSize: 11.5 }}>
        {[...new Set(batches.filter((b) => b.status === 'in_progress').map((b) => b.location))].slice(0, 2).join(', ') || '—'}
      </td>
      <td className="muted">{fmtDate(first.dueDate)}</td>
      <td onClick={(e) => e.stopPropagation()} style={{ whiteSpace: 'nowrap' }}>
        {openBatches.length > 0 && (
          <button className="btn btn-tiny btn-danger" onClick={cancelLot}>✕ cancel lot</button>
        )}
      </td>
    </tr>
  );
}

export function Orders({ state }) {
  const { orders, projects, now } = state;
  const [filter, setFilter] = useState('all');
  const [showForm, setShowForm] = useState(false);
  const [expandedLots, setExpandedLots] = useState(() => new Set());
  const [form, setForm] = useState({ projectId: projects[0]?.id, customer: '', qty: 10, priority: 'normal', transferBatch: 0 });
  const [error, setError] = useState(null);

  const visible = orders.filter((o) => filter === 'all' || o.status === filter);

  // Group flow-mode batches under their lot, preserving list order.
  const rows = [];
  const seenLots = new Set();
  for (const o of visible) {
    if (!o.lotId) {
      rows.push({ kind: 'single', o });
    } else if (!seenLots.has(o.lotId)) {
      seenLots.add(o.lotId);
      rows.push({ kind: 'lot', lotId: o.lotId, batches: visible.filter((b) => b.lotId === o.lotId).sort((a, b) => a.lotSeq - b.lotSeq) });
    }
  }

  async function submit(e) {
    e.preventDefault();
    setError(null);
    try {
      await api.createOrder(form);
      setShowForm(false);
      setForm({ ...form, customer: '', qty: 10, transferBatch: 0 });
    } catch (err) {
      setError(err.message);
    }
  }

  function toggleLot(lotId) {
    const next = new Set(expandedLots);
    next.has(lotId) ? next.delete(lotId) : next.add(lotId);
    setExpandedLots(next);
  }

  return (
    <>
      <div className="page-head">
        <h1>Orders</h1>
        <span className="sub">{orders.filter((o) => o.status !== 'completed' && o.status !== 'cancelled').length} open · {orders.filter((o) => o.status === 'completed').length} completed</span>
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
          <label className="field" title="0 = the whole order moves as one batch. A smaller number splits it into batches that pipeline through the stations — batch 2 enters step 1 while batch 1 is already at step 2.">
            Flow — batch size (0 = off)
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="number" min="0" max={form.qty} value={form.transferBatch} style={{ width: 90 }}
                onChange={(e) => setForm({ ...form, transferBatch: Math.max(0, Number(e.target.value)) })} />
              <span className="muted" style={{ fontSize: 11.5, whiteSpace: 'nowrap' }}>
                {form.transferBatch > 0 && form.transferBatch < form.qty
                  ? `→ ${Math.ceil(form.qty / form.transferBatch)} batches pipeline`
                  : 'single batch'}
              </span>
            </div>
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
              <th>Status</th><th style={{ minWidth: 120 }}>Produced</th><th>Workflow</th><th>Location</th><th>Due</th><th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => row.kind === 'single' ? (
              <OrderRow key={row.o.id} o={row.o} state={state} projects={projects} now={now} />
            ) : (
              [
                <LotRow key={row.lotId} batches={row.batches} projects={projects}
                  expanded={expandedLots.has(row.lotId)} onToggle={() => toggleLot(row.lotId)} />,
                ...(expandedLots.has(row.lotId)
                  ? row.batches.map((b) => <OrderRow key={b.id} o={b} state={state} projects={projects} now={now} indent />)
                  : []),
              ]
            ))}
            {rows.length === 0 && <tr><td colSpan="11" className="empty">No orders match this filter.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
