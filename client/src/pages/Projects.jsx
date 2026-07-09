import { useState } from 'react';
import { api } from '../api.js';
import { Badge, ORDER_STATUS, skuName, skuUnit } from '../ui.jsx';

export function Projects({ state, goTo }) {
  const { projects, orders, workflows } = state;
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', product: '', workflowId: workflows[0]?.id });
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setError(null);
    try {
      await api.createProject(form);
      setShowForm(false);
      setForm({ ...form, name: '', product: '' });
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <>
      <div className="page-head">
        <h1>Projects</h1>
        <span className="sub">Product lines — each runs a workflow you can design on the Workflows page</span>
        <span style={{ flex: 1 }} />
        <button className="btn btn-primary" onClick={() => setShowForm(!showForm)}>+ New product line</button>
      </div>

      {showForm && (
        <form className="card form-row" style={{ marginBottom: 14 }} onSubmit={submit}>
          <label className="field">Line name
            <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Dorado" />
          </label>
          <label className="field">Product
            <input required value={form.product} onChange={(e) => setForm({ ...form, product: e.target.value })} placeholder="e.g. DX-9 Gripper" />
          </label>
          <label className="field">Workflow
            <select value={form.workflowId} onChange={(e) => setForm({ ...form, workflowId: e.target.value })}>
              {workflows.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </label>
          <button className="btn btn-primary" type="submit">Create</button>
          {error && <span className="ink-critical" style={{ fontSize: 12.5 }}>{error}</span>}
        </form>
      )}

      <div className="grid cols-3">
        {projects.map((p) => {
          const wf = workflows.find((w) => w.id === p.workflowId);
          const projectOrders = orders.filter((o) => o.projectId === p.id);
          const open = projectOrders.filter((o) => o.status !== 'completed');
          const done = projectOrders.filter((o) => o.status === 'completed');
          const unitsDone = done.reduce((sum, o) => sum + o.qty, 0);
          return (
            <div key={p.id} className="card">
              <div className="station-head">
                <h3>{p.name}</h3>
                <Badge meta={{ label: p.status, tone: p.status === 'active' ? 'good' : 'neutral', icon: '▶' }} />
              </div>
              <div className="muted" style={{ marginTop: 2 }}>{p.product}</div>

              <h2 className="mt">Workflow (new orders)</h2>
              <select value={p.workflowId ?? ''} onChange={(e) => api.updateProject(p.id, { workflowId: e.target.value }).catch(() => {})}
                style={{ background: 'var(--surface-2)', color: 'var(--ink)', border: '1px solid var(--border)', borderRadius: 7, padding: '5px 8px', width: '100%' }}>
                {workflows.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
              {wf && (
                <>
                  <div className="pips" style={{ marginTop: 8 }}>
                    {wf.flat.map((s, i) => (
                      <span key={i} className="pip pip-done"><span className="pip-dot" /><span className="pip-name">{i + 1}. {s.icon} {s.name}</span></span>
                    ))}
                  </div>
                  <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                    ≈ {wf.totals.timeSecPerUnit}s designed
                    {wf.totals.measuredSecPerUnit != null && <> · {wf.totals.measuredSecPerUnit}s measured</>}
                    {' '}per unit
                    · <a style={{ color: 'var(--accent)', cursor: 'pointer' }} onClick={() => goTo('workflows')}>edit workflow →</a>
                  </div>
                </>
              )}

              <h2 className="mt">Orders</h2>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <Badge meta={ORDER_STATUS.in_progress}>{open.filter((o) => o.status === 'in_progress').length} in progress</Badge>
                <Badge meta={ORDER_STATUS.queued}>{open.filter((o) => o.status === 'queued').length} queued</Badge>
                <Badge meta={ORDER_STATUS.on_hold}>{open.filter((o) => o.status === 'on_hold').length} held</Badge>
                <Badge meta={ORDER_STATUS.completed}>{done.length} done · {unitsDone} units</Badge>
              </div>

              {wf && wf.totals.inputsPerUnit.length > 0 && (
                <>
                  <h2 className="mt">Materials per unit</h2>
                  <table>
                    <tbody>
                      {wf.totals.inputsPerUnit.map(({ sku, qty }) => (
                        <tr key={sku}>
                          <td style={{ padding: '4px 6px' }}>{skuName(state, sku)}</td>
                          <td className="num muted" style={{ padding: '4px 6px', textAlign: 'right' }}>{qty} {skuUnit(state, sku)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
