import { Badge, ORDER_STATUS } from '../ui.jsx';

export function Projects({ state }) {
  const { projects, orders, stations, stageNames, inventory } = state;

  return (
    <>
      <div className="page-head">
        <h1>Projects</h1>
        <span className="sub">Product lines and their production workflows</span>
      </div>

      <div className="grid cols-3">
        {projects.map((p) => {
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

              <h2 className="mt">Workflow</h2>
              <div className="pips">
                {p.workflow.map((stage, i) => (
                  <span key={stage} className="pip pip-done">
                    <span className="pip-dot" />
                    <span className="pip-name">{i + 1}. {stageNames[stage]}</span>
                  </span>
                ))}
              </div>
              <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                Runs on: {p.workflow.map((stage) => stations.filter((s) => s.stage === stage).map((s) => s.name).join(', ')).join(' → ')}
              </div>

              <h2 className="mt">Orders</h2>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <Badge meta={ORDER_STATUS.in_progress}>{open.filter((o) => o.status === 'in_progress').length} in progress</Badge>
                <Badge meta={ORDER_STATUS.queued}>{open.filter((o) => o.status === 'queued').length} queued</Badge>
                <Badge meta={ORDER_STATUS.on_hold}>{open.filter((o) => o.status === 'on_hold').length} held</Badge>
                <Badge meta={ORDER_STATUS.completed}>{done.length} done · {unitsDone} units</Badge>
              </div>

              <h2 className="mt">Bill of materials (per unit)</h2>
              <table>
                <tbody>
                  {Object.entries(p.bom).map(([sku, qty]) => {
                    const item = inventory.find((i) => i.sku === sku);
                    return (
                      <tr key={sku}>
                        <td style={{ padding: '4px 6px' }}>{item?.name ?? sku}</td>
                        <td className="num muted" style={{ padding: '4px 6px', textAlign: 'right' }}>{qty} {item?.unit}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>
    </>
  );
}
