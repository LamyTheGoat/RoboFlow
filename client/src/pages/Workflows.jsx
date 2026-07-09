import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { typeById, skuName } from '../ui.jsx';

// ---- client-side helpers (mirror server catalog rules for instant feedback) ------
function reaches(workflows, fromId, targetId, path = new Set()) {
  if (fromId === targetId) return true;
  if (path.has(fromId)) return false;
  path.add(fromId);
  const wf = workflows.find((w) => w.id === fromId);
  return (wf?.steps ?? []).some((s) => s.kind === 'workflow' && reaches(workflows, s.refId, targetId, path));
}

function typeReaches(types, fromId, targetId, path = new Set()) {
  if (fromId === targetId) return true;
  if (path.has(fromId)) return false;
  path.add(fromId);
  const t = types.find((x) => x.id === fromId);
  return (t?.children ?? []).some((c) => typeReaches(types, c, targetId, path));
}

function leafTypes(types, typeId, path = new Set()) {
  const t = types.find((x) => x.id === typeId);
  if (!t || path.has(typeId)) return [];
  if (!t.composite) return [t];
  path.add(typeId);
  const out = (t.children ?? []).flatMap((c) => leafTypes(types, c, path));
  path.delete(typeId);
  return out;
}

// Flatten a draft (unsaved) workflow for the live preview strip.
function flattenDraft(state, steps, path = new Set()) {
  const out = [];
  for (const step of steps ?? []) {
    if (step.kind === 'workflow') {
      if (path.has(step.refId)) continue;
      path.add(step.refId);
      out.push(...flattenDraft(state, state.workflows.find((w) => w.id === step.refId)?.steps, path));
      path.delete(step.refId);
    } else {
      const t = typeById(state, step.refId);
      if (!t) continue;
      if (t.composite) out.push(...leafTypes(state.stationTypes, t.id));
      else out.push({
        ...t,
        inputs: step.inputs?.length ? step.inputs : t.inputs,
        outputs: step.outputs?.length ? step.outputs : t.outputs,
      });
    }
  }
  return out;
}

const EMOJI_PRESETS = ['⚙️', '✂️', '🔥', '🔧', '🎨', '🔍', '📦', '🏭', '🤖', '⚡', '🧪', '💧', '🪚', '🧲', '🛠️', '🧊'];

// One line of a step's material interface: either the override editor, or the
// type-default summary with a "customize" link that copies defaults in.
function StepIO({ state, label, list, defaults, onChange }) {
  if (list?.length) {
    return (
      <div style={{ marginTop: 6 }}>
        <div className="muted" style={{ fontSize: 11, marginBottom: 3 }}>{label} (customized for this step)</div>
        <InputsEditor state={state} inputs={list} compact onChange={onChange} />
      </div>
    );
  }
  return (
    <div className="muted" style={{ fontSize: 11.5, marginTop: 2 }}>
      {label}: {defaults?.length ? defaults.map((x) => `${x.qty}× ${skuName(state, x.sku)}`).join(', ') : 'nothing'}
      {' '}· <a className="link" onClick={() =>
        onChange(JSON.parse(JSON.stringify(defaults?.length ? defaults : [{ sku: state.inventory[0].sku, qty: 1 }])))
      }>customize</a>
    </div>
  );
}

// ---- inputs (materials) row editor -----------------------------------------------
function InputsEditor({ state, inputs, onChange, compact }) {
  const skus = state.inventory;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      {(inputs ?? []).map((row, i) => (
        <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <select value={row.sku} onChange={(e) => onChange(inputs.map((r, j) => (j === i ? { ...r, sku: e.target.value } : r)))} className="mini-input" style={{ flex: 1 }}>
            {skus.map((s) => <option key={s.sku} value={s.sku}>{s.name}</option>)}
          </select>
          <input type="number" step="0.1" min="0.1" value={row.qty} className="mini-input" style={{ width: 70 }}
            onChange={(e) => onChange(inputs.map((r, j) => (j === i ? { ...r, qty: Number(e.target.value) } : r)))} />
          <span className="muted" style={{ fontSize: 11, width: 26 }}>{state.inventory.find((s) => s.sku === row.sku)?.unit}</span>
          <button type="button" className="btn btn-tiny" onClick={() => onChange(inputs.filter((_, j) => j !== i))}>✕</button>
        </div>
      ))}
      <button type="button" className="btn btn-tiny" style={{ alignSelf: 'start' }}
        onClick={() => onChange([...(inputs ?? []), { sku: skus[0]?.sku, qty: 1 }])}>
        + {compact ? 'material' : 'add material'}
      </button>
    </div>
  );
}

// ==================================================================================
// Workflow editor tab
// ==================================================================================
function WorkflowsTab({ state, canDesign }) {
  const { workflows, stationTypes } = state;
  const [selectedId, setSelectedId] = useState(workflows[0]?.id ?? null);
  const [draft, setDraft] = useState(null);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);

  const selected = workflows.find((w) => w.id === selectedId);
  useEffect(() => {
    setError(null);
    setSaved(false);
    if (selectedId === 'new') {
      setDraft({ name: '', description: '', steps: [], outputs: [] });
    } else if (selected) {
      setDraft(JSON.parse(JSON.stringify({ name: selected.name, description: selected.description, steps: selected.steps, outputs: selected.outputs })));
    } else {
      setDraft(null);
    }
  }, [selectedId, selected?.id]);

  if (!draft && workflows.length === 0) setSelectedId('new');

  function move(i, dir) {
    const steps = [...draft.steps];
    const j = i + dir;
    if (j < 0 || j >= steps.length) return;
    [steps[i], steps[j]] = [steps[j], steps[i]];
    setDraft({ ...draft, steps });
  }

  async function save() {
    setError(null);
    try {
      if (selectedId === 'new') {
        const created = await api.createWorkflow(draft);
        setSelectedId(created.id);
      } else {
        await api.updateWorkflow(selectedId, draft);
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err.message);
    }
  }

  async function remove() {
    if (!window.confirm(`Delete workflow "${draft.name}"?`)) return;
    setError(null);
    try {
      await api.deleteWorkflow(selectedId);
      setSelectedId(workflows.find((w) => w.id !== selectedId)?.id ?? 'new');
    } catch (err) {
      setError(err.message);
    }
  }

  const flat = draft ? flattenDraft(state, draft.steps) : [];
  const totalTime = flat.reduce((s, f) => s + (f.timeSecPerUnit ?? 0), 0);
  const anyMeasured = flat.some((f) => f.measuredSecPerUnit != null);
  const measuredTime = flat.reduce((s, f) => s + (f.measuredSecPerUnit ?? f.timeSecPerUnit ?? 0), 0);

  // Material-flow sanity check: does every half-product input get produced by
  // an earlier step (or already sit in stock)? Not an error — another line may
  // be stocking it — but worth a visible heads-up.
  const flowWarnings = [];
  {
    const balance = new Map();
    flat.forEach((s, i) => {
      for (const inp of s.inputs ?? []) {
        const item = state.inventory.find((x) => x.sku === inp.sku);
        if (item?.category === 'Half product') {
          const have = balance.get(inp.sku) ?? 0;
          if (have < inp.qty && (item.qty ?? 0) <= 0) {
            flowWarnings.push(`Step ${i + 1} (${s.name}) needs ${skuName(state, inp.sku)}, but no earlier step produces it and stock is empty — it will wait until another line makes some.`);
          }
          balance.set(inp.sku, Math.max(0, have - inp.qty));
        }
      }
      for (const out of s.outputs ?? []) balance.set(out.sku, (balance.get(out.sku) ?? 0) + out.qty);
    });
  }

  return (
    <div className="designer-split">
      <div className="designer-list">
        {workflows.map((w) => (
          <button key={w.id} className={`list-item${selectedId === w.id ? ' active' : ''}`} onClick={() => setSelectedId(w.id)}>
            <span style={{ fontWeight: 600 }}>{w.name}</span>
            <span className="muted" style={{ fontSize: 11.5 }}>{w.flat.length} steps · {w.steps.some((s) => s.kind === 'workflow') ? 'nested ⤵' : 'simple'}</span>
          </button>
        ))}
        {canDesign && <button className={`list-item new${selectedId === 'new' ? ' active' : ''}`} onClick={() => setSelectedId('new')}>+ New workflow</button>}
      </div>

      {draft && (
        <div className="card designer-editor">
          <div className="form-row">
            <label className="field" style={{ flex: 1 }}>Workflow name
              <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. Gearbox Line" />
            </label>
            <label className="field" style={{ flex: 2 }}>Description
              <input value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} placeholder="What does this workflow produce?" />
            </label>
          </div>

          <h2 className="mt">Steps — run top to bottom</h2>
          {draft.steps.length === 0 && <div className="muted" style={{ fontSize: 12.5 }}>No steps yet. Add stations (or whole workflows) below.</div>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {draft.steps.map((step, i) => {
              const isWf = step.kind === 'workflow';
              const ref = isWf ? workflows.find((w) => w.id === step.refId) : typeById(state, step.refId);
              return (
                <div key={i} className="step-row">
                  <span className="step-num">{i + 1}</span>
                  <span className="step-icon">{isWf ? '🔁' : ref?.icon}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600 }}>
                      {ref?.name ?? '?'}
                      <span className="muted" style={{ fontWeight: 400, fontSize: 11.5 }}>
                        {' '}{isWf ? `— workflow (${state.workflows.find((w) => w.id === step.refId)?.flat.length ?? 0} inner steps)` : ref?.composite ? '— composite station' : `— ${ref?.timeSecPerUnit}s/unit`}
                      </span>
                    </div>
                    {!isWf && !ref?.composite && (
                      <>
                        <StepIO state={state} label="⬅ consumes" list={step.inputs} defaults={ref?.inputs}
                          onChange={(inputs) => setDraft({ ...draft, steps: draft.steps.map((s, j) => (j === i ? { ...s, inputs: inputs.length ? inputs : undefined } : s)) })} />
                        <StepIO state={state} label="➡ produces" list={step.outputs} defaults={ref?.outputs}
                          onChange={(outputs) => setDraft({ ...draft, steps: draft.steps.map((s, j) => (j === i ? { ...s, outputs: outputs.length ? outputs : undefined } : s)) })} />
                      </>
                    )}
                  </div>
                  <div className="step-ctl">
                    <button className="btn btn-tiny" disabled={i === 0} onClick={() => move(i, -1)}>▲</button>
                    <button className="btn btn-tiny" disabled={i === draft.steps.length - 1} onClick={() => move(i, 1)}>▼</button>
                    <button className="btn btn-tiny" onClick={() => setDraft({ ...draft, steps: draft.steps.filter((_, j) => j !== i) })}>✕</button>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="form-row mt">
            <label className="field">Add a step
              <select value="" onChange={(e) => {
                if (!e.target.value) return;
                const [kind, refId] = e.target.value.split(':');
                setDraft({ ...draft, steps: [...draft.steps, { kind, refId }] });
              }}>
                <option value="">choose…</option>
                <optgroup label="Stations">
                  {stationTypes.map((t) => <option key={t.id} value={`station:${t.id}`}>{t.icon} {t.name}{t.composite ? ' (composite)' : ''}</option>)}
                </optgroup>
                <optgroup label="Workflows (nested)">
                  {workflows
                    .filter((w) => selectedId === 'new' || (w.id !== selectedId && !reaches(workflows, w.id, selectedId)))
                    .map((w) => <option key={w.id} value={`workflow:${w.id}`}>🔁 {w.name}</option>)}
                </optgroup>
              </select>
            </label>
          </div>

          <h2 className="mt">Preview — what an order will actually walk through</h2>
          <div className="pips">
            {flat.map((s, i) => (
              <span key={i} className="pip pip-done"><span className="pip-dot" /><span className="pip-name">{i + 1}. {s.icon} {s.name}</span></span>
            ))}
            {flat.length === 0 && <span className="muted" style={{ fontSize: 12 }}>nothing yet</span>}
          </div>
          {flat.length > 0 && (
            <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
              ≈ {totalTime.toFixed(1)}s designed
              {anyMeasured && <> · <span style={{ color: measuredTime > totalTime * 1.15 ? 'var(--warning)' : 'var(--ink-2)' }}>{measuredTime.toFixed(1)}s measured on the floor</span></>}
              {' '}per unit
            </div>
          )}
          {flowWarnings.map((w, i) => (
            <div key={i} className="hint-bar warn" style={{ marginTop: 8, marginBottom: 0 }}>⚠ {w}</div>
          ))}

          <div className="form-row mt" style={{ alignItems: 'center' }}>
            <button className="btn btn-primary" onClick={save} disabled={!canDesign || !draft.name.trim() || draft.steps.length === 0} title={canDesign ? undefined : 'manager role required'}>
              {selectedId === 'new' ? 'Create workflow' : 'Save changes'}
            </button>
            {selectedId !== 'new' && canDesign && <button className="btn btn-danger" onClick={remove}>Delete</button>}
            {saved && <span className="ink-good" style={{ fontSize: 12.5 }}>✓ saved</span>}
            {error && <span className="ink-critical" style={{ fontSize: 12.5 }}>{error}</span>}
            <span className="muted" style={{ fontSize: 11.5, marginLeft: 'auto' }}>Edits apply to new orders; orders on the floor keep their routing.</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ==================================================================================
// Station type editor tab
// ==================================================================================
function StationTypesTab({ state, canDesign }) {
  const { stationTypes } = state;
  const [selectedId, setSelectedId] = useState(stationTypes[0]?.id ?? 'new');
  const [draft, setDraft] = useState(null);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);
  const [newHalfProduct, setNewHalfProduct] = useState('');

  const selected = stationTypes.find((t) => t.id === selectedId);
  useEffect(() => {
    setError(null);
    setSaved(false);
    if (selectedId === 'new') {
      setDraft({ name: '', icon: '⚙️', description: '', timeSecPerUnit: 3, inputs: [], outputs: [], composite: false, children: [], w: 1, h: 1 });
    } else if (selected) {
      setDraft(JSON.parse(JSON.stringify(selected)));
    }
  }, [selectedId, selected?.id]);

  async function save() {
    setError(null);
    try {
      if (selectedId === 'new') {
        const created = await api.createStationType(draft);
        setSelectedId(created.id);
      } else {
        await api.updateStationType(selectedId, draft);
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err.message);
    }
  }

  async function remove() {
    if (!window.confirm(`Delete station type "${draft.name}"?`)) return;
    try {
      await api.deleteStationType(selectedId);
      setSelectedId(stationTypes.find((t) => t.id !== selectedId)?.id ?? 'new');
    } catch (err) {
      setError(err.message);
    }
  }

  const placedCount = (id) => state.stations.filter((s) => s.typeId === id).length;

  return (
    <div className="designer-split">
      <div className="designer-list">
        {stationTypes.map((t) => (
          <button key={t.id} className={`list-item${selectedId === t.id ? ' active' : ''}`} onClick={() => setSelectedId(t.id)}>
            <span style={{ fontWeight: 600 }}>{t.icon} {t.name}</span>
            <span className="muted" style={{ fontSize: 11.5 }}>
              {t.composite ? `contains ${t.children.length} stations` : `${t.timeSecPerUnit}s/unit`} · {t.w ?? 1}×{t.h ?? 1} · {placedCount(t.id)} on floor
            </span>
          </button>
        ))}
        {canDesign && <button className={`list-item new${selectedId === 'new' ? ' active' : ''}`} onClick={() => setSelectedId('new')}>+ New station type</button>}
      </div>

      {draft && (
        <div className="card designer-editor">
          <div className="form-row">
            <label className="field">Icon
              <input value={draft.icon} onChange={(e) => setDraft({ ...draft, icon: e.target.value })} style={{ width: 64, textAlign: 'center', fontSize: 18 }} />
            </label>
            <label className="field" style={{ flex: 1 }}>Station name
              <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. Gearbox Press" />
            </label>
            <label className="field" style={{ flex: 2 }}>Description
              <input value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} placeholder="What does it do?" />
            </label>
          </div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 6 }}>
            {EMOJI_PRESETS.map((e) => (
              <button key={e} type="button" className={`emoji-btn${draft.icon === e ? ' active' : ''}`} onClick={() => setDraft({ ...draft, icon: e })}>{e}</button>
            ))}
          </div>

          <div className="form-row mt" style={{ alignItems: 'end' }}>
            <label className="field">Footprint — width (cells)
              <input type="number" min="1" max="4" value={draft.w ?? 1}
                onChange={(e) => setDraft({ ...draft, w: Number(e.target.value) })} style={{ width: 90 }} />
            </label>
            <label className="field">depth (cells)
              <input type="number" min="1" max="4" value={draft.h ?? 1}
                onChange={(e) => setDraft({ ...draft, h: Number(e.target.value) })} style={{ width: 90 }} />
            </label>
            <div className="footprint-preview" title="How much floor it takes">
              {Array.from({ length: (draft.h ?? 1) }, (_, r) => (
                <div key={r} style={{ display: 'flex', gap: 2 }}>
                  {Array.from({ length: (draft.w ?? 1) }, (_, c) => <span key={c} className="footprint-cell" />)}
                </div>
              ))}
            </div>
            <span className="muted" style={{ fontSize: 11.5, paddingBottom: 4 }}>
              Stations already on the floor keep their size — footprint applies to new installs.
            </span>
          </div>

          <label className="field mt" style={{ flexDirection: 'row', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--ink-2)' }}>
            <input type="checkbox" checked={draft.composite}
              onChange={(e) => setDraft({ ...draft, composite: e.target.checked })} />
            Composite station — one physical cell that contains several inner stations and can do all of their jobs
          </label>

          {draft.composite ? (
            <>
              <h2 className="mt">Inner stations (in working order)</h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {draft.children.map((cid, i) => {
                  const child = typeById(state, cid);
                  return (
                    <div key={i} className="step-row">
                      <span className="step-num">{i + 1}</span>
                      <span className="step-icon">{child?.icon}</span>
                      <span style={{ flex: 1, fontWeight: 600 }}>{child?.name ?? cid}{child?.composite ? <span className="muted" style={{ fontWeight: 400 }}> (composite ⤵)</span> : null}</span>
                      <div className="step-ctl">
                        <button className="btn btn-tiny" disabled={i === 0} onClick={() => { const c = [...draft.children]; [c[i - 1], c[i]] = [c[i], c[i - 1]]; setDraft({ ...draft, children: c }); }}>▲</button>
                        <button className="btn btn-tiny" disabled={i === draft.children.length - 1} onClick={() => { const c = [...draft.children]; [c[i + 1], c[i]] = [c[i], c[i + 1]]; setDraft({ ...draft, children: c }); }}>▼</button>
                        <button className="btn btn-tiny" onClick={() => setDraft({ ...draft, children: draft.children.filter((_, j) => j !== i) })}>✕</button>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="form-row" style={{ marginTop: 8 }}>
                <label className="field">Add inner station
                  <select value="" onChange={(e) => e.target.value && setDraft({ ...draft, children: [...draft.children, e.target.value] })}>
                    <option value="">choose…</option>
                    {stationTypes
                      .filter((t) => t.id !== selectedId && !draft.children.includes(t.id) && (selectedId === 'new' || !typeReaches(stationTypes, t.id, selectedId)))
                      .map((t) => <option key={t.id} value={t.id}>{t.icon} {t.name}{t.composite ? ' (composite)' : ''}</option>)}
                  </select>
                </label>
              </div>
            </>
          ) : (
            <>
              <div className="form-row mt" style={{ alignItems: 'end' }}>
                <label className="field">Time per unit (seconds)
                  <input type="number" step="0.5" min="0.5" value={draft.timeSecPerUnit}
                    onChange={(e) => setDraft({ ...draft, timeSecPerUnit: Number(e.target.value) })} style={{ width: 100 }} />
                </label>
                {selectedId !== 'new' && selected?.measuredSecPerUnit != null && (
                  <div className="pace-row" style={{ paddingBottom: 6 }}>
                    <span className={selected.measuredSecPerUnit > draft.timeSecPerUnit * 1.3 ? 'drift' : undefined}>
                      ⏱ measured on the floor: {selected.measuredSecPerUnit}s/unit
                    </span>
                    <button type="button" className="btn btn-tiny" title="Replace the designed time with the measured average"
                      onClick={async () => {
                        setError(null);
                        try {
                          const updated = await api.adoptMeasured(selectedId);
                          setDraft({ ...draft, timeSecPerUnit: updated.timeSecPerUnit });
                          setSaved(true);
                          setTimeout(() => setSaved(false), 2000);
                        } catch (err) {
                          setError(err.message);
                        }
                      }}>
                      adopt measured time
                    </button>
                  </div>
                )}
              </div>
              <h2 className="mt">Inputs — consumed from stock per unit (raw materials or half products)</h2>
              <InputsEditor state={state} inputs={draft.inputs} onChange={(inputs) => setDraft({ ...draft, inputs })} />
              <h2 className="mt">Outputs — put back into stock per unit (usually a half product)</h2>
              <InputsEditor state={state} inputs={draft.outputs ?? []} onChange={(outputs) => setDraft({ ...draft, outputs })} />
              <div className="form-row" style={{ marginTop: 10, alignItems: 'end' }}>
                <label className="field">Need a new half product? Define it here, then pick it above
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input className="mini-input" placeholder="e.g. Bent Sheet" value={newHalfProduct}
                      onChange={(e) => setNewHalfProduct(e.target.value)} style={{ width: 180 }} />
                    <button type="button" className="btn btn-tiny" disabled={!newHalfProduct.trim()}
                      onClick={async () => {
                        setError(null);
                        try {
                          await api.createInventoryItem({ name: newHalfProduct.trim() });
                          setNewHalfProduct('');
                        } catch (err) {
                          setError(err.message);
                        }
                      }}>+ create</button>
                  </div>
                </label>
              </div>
            </>
          )}

          <div className="form-row mt" style={{ alignItems: 'center' }}>
            <button className="btn btn-primary" onClick={save} disabled={!canDesign || !draft.name.trim() || (draft.composite && draft.children.length < 2)} title={canDesign ? undefined : 'manager role required'}>
              {selectedId === 'new' ? 'Create station type' : 'Save changes'}
            </button>
            {selectedId !== 'new' && canDesign && <button className="btn btn-danger" onClick={remove}>Delete</button>}
            {saved && <span className="ink-good" style={{ fontSize: 12.5 }}>✓ saved</span>}
            {error && <span className="ink-critical" style={{ fontSize: 12.5 }}>{error}</span>}
            <span className="muted" style={{ fontSize: 11.5, marginLeft: 'auto' }}>Place designed stations on the floor from the Factory page.</span>
          </div>
        </div>
      )}
    </div>
  );
}

export function Workflows({ state, user }) {
  const [tab, setTab] = useState('workflows');
  const canDesign = user?.role === 'manager';
  return (
    <>
      <div className="page-head">
        <h1>Design studio</h1>
        <span className="sub">Design your stations, chain them into workflows, nest workflows inside workflows</span>
        {!canDesign && <span className="muted" style={{ fontSize: 12 }}>view only — manager role can edit designs</span>}
      </div>
      <div className="filters">
        <button className={`chip${tab === 'workflows' ? ' active' : ''}`} onClick={() => setTab('workflows')}>🔁 Workflows ({state.workflows.length})</button>
        <button className={`chip${tab === 'types' ? ' active' : ''}`} onClick={() => setTab('types')}>⚙️ Station types ({state.stationTypes.length})</button>
      </div>
      {tab === 'workflows' ? <WorkflowsTab state={state} canDesign={canDesign} /> : <StationTypesTab state={state} canDesign={canDesign} />}
    </>
  );
}
