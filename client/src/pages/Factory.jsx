import { useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import { Badge, STATION_STATUS, typeById } from '../ui.jsx';

const CELL = 64;
const GUTTER = 110; // warehouse / dispatch zones flanking the grid

export function Factory({ state, user }) {
  const { stations, orders, workflows, stationTypes, now } = state;
  const canDesign = user?.role === 'manager';
  const grid = state.factory.grid ?? { w: 20, h: 12 };
  const [mode, setMode] = useState('select'); // select | remove | place:<typeId>
  const [selectedId, setSelectedId] = useState(null);
  const [moving, setMoving] = useState(false);
  const [wfId, setWfId] = useState(workflows[0]?.id ?? '');
  const [error, setError] = useState(null);
  const [hover, setHover] = useState(null); // {x, y} grid cell under the cursor
  const [rotated, setRotated] = useState(false); // swap footprint w/h when placing
  const [floorForm, setFloorForm] = useState(null); // {w, h} while editing floor size
  const boardRef = useRef(null);

  const selected = stations.find((s) => s.id === selectedId) ?? null;
  const wf = workflows.find((w) => w.id === wfId);

  const boardW = GUTTER * 2 + grid.w * CELL;
  const boardH = grid.h * CELL;
  const dims = (s) => ({ w: s.w ?? 1, h: s.h ?? 1 });
  const cellCenter = (s) => {
    const d = dims(s);
    return { x: GUTTER + (s.x + d.w / 2) * CELL, y: (s.y + d.h / 2) * CELL };
  };
  const stationAt = (x, y) => stations.find((s) => {
    const d = dims(s);
    return x >= s.x && x < s.x + d.w && y >= s.y && y < s.y + d.h;
  });

  // Pick one representative station per workflow step for the conveyor path.
  const { pathPoints, missingSteps } = useMemo(() => {
    if (!wf) return { pathPoints: [], missingSteps: [] };
    const serves = (station, leafTypeId) => {
      const walk = (tid, seen = new Set()) => {
        if (tid === leafTypeId) return true;
        if (seen.has(tid)) return false;
        seen.add(tid);
        const t = stationTypes.find((x) => x.id === tid);
        return !!t?.composite && t.children.some((c) => walk(c, seen));
      };
      return walk(station.typeId);
    };
    const points = [{ x: GUTTER / 2, y: boardH / 2, label: '📥' }];
    const missing = [];
    for (const step of wf.flat) {
      const st = stations.filter((s) => serves(s, step.typeId)).sort((a, b) => a.id.localeCompare(b.id))[0];
      if (st) points.push({ ...cellCenter(st), label: step.icon, stationId: st.id });
      else missing.push(step);
    }
    points.push({ x: boardW - GUTTER / 2, y: boardH / 2, label: '🚚' });
    return { pathPoints: points, missingSteps: missing };
  }, [wfId, stations, stationTypes, wf?.flat?.length]);

  // Order pucks: live positions of every open order on the floor.
  const pucks = useMemo(() => {
    const out = [];
    let staged = 0;
    let shipped = 0;
    for (const o of orders) {
      if (o.status === 'completed') {
        if (now - (o.completedAt ?? 0) < 3 * 60 * 1000) {
          out.push({ o, x: boardW - GUTTER / 2, y: 40 + shipped * 26, done: true });
          shipped++;
        }
        continue;
      }
      if (o.status === 'cancelled') continue;
      const st = stations.find((s) => s.currentOrderId === o.id);
      if (st) {
        const c = cellCenter(st);
        out.push({ o, x: c.x, y: c.y + (dims(st).h * CELL) / 2 + 4 });
      } else {
        out.push({ o, x: GUTTER / 2, y: 40 + staged * 26, waiting: true });
        staged++;
      }
    }
    return out;
  }, [orders, stations, now]);

  function cellFromEvent(e) {
    const rect = boardRef.current.getBoundingClientRect();
    const x = Math.floor((e.clientX - rect.left - GUTTER) / CELL);
    const y = Math.floor((e.clientY - rect.top) / CELL);
    return x >= 0 && y >= 0 && x < grid.w && y < grid.h ? { x, y } : null;
  }

  // Footprint about to be placed/moved at the hovered cell, with validity.
  const ghost = useMemo(() => {
    if (!hover) return null;
    let w, h;
    if (mode.startsWith('place:')) {
      const t = typeById(state, mode.slice(6));
      w = rotated ? (t?.h ?? 1) : (t?.w ?? 1);
      h = rotated ? (t?.w ?? 1) : (t?.h ?? 1);
    } else if (moving && selected) {
      ({ w, h } = dims(selected));
    } else {
      return null;
    }
    const inBounds = hover.x + w <= grid.w && hover.y + h <= grid.h;
    const clash = stations.some((s) => {
      if (moving && selected && s.id === selected.id) return false;
      const d = dims(s);
      return hover.x < s.x + d.w && s.x < hover.x + w && hover.y < s.y + d.h && s.y < hover.y + h;
    });
    return { x: hover.x, y: hover.y, w, h, valid: inBounds && !clash };
  }, [hover, mode, moving, selectedId, stations, rotated]);

  async function onBoardClick(e) {
    const cell = cellFromEvent(e);
    if (!cell) return;
    const { x, y } = cell;
    const hit = stationAt(x, y);
    setError(null);
    try {
      if (mode.startsWith('place:')) {
        if (hit) throw new Error('that spot is occupied');
        await api.placeStation({ typeId: mode.slice(6), x, y, rotated });
      } else if (mode === 'remove') {
        if (hit) await api.removeStation(hit.id);
      } else if (moving && selected && !hit) {
        await api.updateStation(selected.id, { x, y });
        setMoving(false);
      } else {
        setSelectedId(hit?.id ?? null);
        setMoving(false);
      }
    } catch (err) {
      setError(err.message);
    }
  }

  const segments = pathPoints.slice(0, -1).map((p, i) => ({ from: p, to: pathPoints[i + 1] }));

  return (
    <>
      <div className="page-head">
        <h1>Factory floor</h1>
        <span className="sub">Place stations like a builder game — they instantly join the live plant</span>
        {error && <span className="ink-critical" style={{ fontSize: 13 }}>{error}</span>}
      </div>

      <div className="filters" style={{ alignItems: 'center' }}>
        <button className={`chip${mode === 'select' ? ' active' : ''}`} onClick={() => setMode('select')}>🖱 Select</button>
        {canDesign && stationTypes.map((t) => (
          <button key={t.id} className={`chip${mode === `place:${t.id}` ? ' active' : ''}`}
            title={`${t.description} — footprint ${t.w ?? 1}×${t.h ?? 1} cells`}
            onClick={() => setMode(mode === `place:${t.id}` ? 'select' : `place:${t.id}`)}>
            {t.icon} {t.name} <span className="muted" style={{ fontSize: 10 }}>{t.w ?? 1}×{t.h ?? 1}</span>
          </button>
        ))}
        {canDesign && <button className={`chip${mode === 'remove' ? ' active' : ''}`} onClick={() => setMode(mode === 'remove' ? 'select' : 'remove')}>🗑 Remove</button>}
        {!canDesign && <span className="muted" style={{ fontSize: 12 }}>view only — manager role can edit the floor</span>}
        <span style={{ flex: 1 }} />
        <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          show route
          <select value={wfId} onChange={(e) => setWfId(e.target.value)}>
            <option value="">— none —</option>
            {workflows.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </label>
        {canDesign && (floorForm ? (
          <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
            <input className="mini-input" type="number" min="8" max="60" style={{ width: 62 }} value={floorForm.w}
              onChange={(e) => setFloorForm({ ...floorForm, w: Number(e.target.value) })} />
            ×
            <input className="mini-input" type="number" min="6" max="40" style={{ width: 62 }} value={floorForm.h}
              onChange={(e) => setFloorForm({ ...floorForm, h: Number(e.target.value) })} />
            <button className="btn btn-primary" onClick={async () => {
              setError(null);
              try {
                await api.updateFactory({ gridW: floorForm.w, gridH: floorForm.h });
                setFloorForm(null);
              } catch (err) {
                setError(err.message);
              }
            }}>Apply</button>
            <button className="btn" onClick={() => setFloorForm(null)}>Cancel</button>
          </span>
        ) : (
          <button className="chip" onClick={() => setFloorForm({ w: grid.w, h: grid.h })}>⛶ Floor {grid.w}×{grid.h}</button>
        ))}
      </div>

      {mode.startsWith('place:') && (
        <div className="hint-bar" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span>
            Click an empty area to install a {typeById(state, mode.slice(6))?.icon} <b>{typeById(state, mode.slice(6))?.name}</b>
            {' '}({(rotated ? typeById(state, mode.slice(6))?.h : typeById(state, mode.slice(6))?.w) ?? 1}×{(rotated ? typeById(state, mode.slice(6))?.w : typeById(state, mode.slice(6))?.h) ?? 1} cells).
            It becomes a real station immediately.
          </span>
          <button className="btn btn-tiny" onClick={() => setRotated(!rotated)}>↻ rotate</button>
        </div>
      )}
      {mode === 'remove' && <div className="hint-bar warn">Click a station to dismantle it (busy stations refuse).</div>}
      {moving && <div className="hint-bar">Click an empty cell to move <b>{selected?.name}</b> there.</div>}
      {missingSteps.length > 0 && (
        <div className="hint-bar warn">
          ⚠ Route incomplete — no station can do: {missingSteps.map((s) => `${s.icon} ${s.name}`).join(', ')}. Place one from the palette.
        </div>
      )}

      <div className="board-scroll card" style={{ padding: 10 }}>
        <div className="board" ref={boardRef} style={{ width: boardW, height: boardH }} onClick={onBoardClick}
          onMouseMove={(e) => setHover(cellFromEvent(e))} onMouseLeave={() => setHover(null)}>
          <div className="zone zone-in" style={{ width: GUTTER - 14 }}><span>📥</span>WAREHOUSE</div>
          <div className="zone zone-out" style={{ width: GUTTER - 14 }}><span>🚚</span>DISPATCH</div>
          <div className="board-grid" style={{ left: GUTTER, width: grid.w * CELL, backgroundSize: `${CELL}px ${CELL}px` }} />

          <svg className="board-svg" width={boardW} height={boardH}>
            <defs>
              <marker id="arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0,0.5 L7.5,4 L0,7.5 z" fill="var(--accent)" opacity="0.9" />
              </marker>
            </defs>
            {segments.map((seg, i) => {
              const mx = (seg.from.x + seg.to.x) / 2;
              const bend = seg.from.y === seg.to.y ? 0 : (seg.to.y > seg.from.y ? 18 : -18);
              return (
                <path key={i}
                  d={`M${seg.from.x},${seg.from.y} Q${mx},${(seg.from.y + seg.to.y) / 2 + bend} ${seg.to.x},${seg.to.y}`}
                  className="conveyor" markerEnd="url(#arrow)" />
              );
            })}
          </svg>

          {stations.map((s) => {
            const order = orders.find((o) => o.id === s.currentOrderId);
            const type = typeById(state, s.typeId);
            const d = dims(s);
            return (
              <div key={s.id}
                className={`tile status-${s.status}${selectedId === s.id ? ' selected' : ''}`}
                style={{
                  left: GUTTER + s.x * CELL + 3, top: s.y * CELL + 3,
                  width: d.w * CELL - 6, height: d.h * CELL - 6,
                }}
                title={`${s.name} (${d.w}×${d.h}) — ${STATION_STATUS[s.status].label}${order ? ` · ${order.code}` : ''}`}>
                <span className="tile-icon" style={{ fontSize: 20 + Math.min(d.w, d.h) * 6 }}>{type?.icon}</span>
                <span className="tile-name" style={{ fontSize: d.w > 1 ? 10 : 8.5 }}>{s.name}</span>
                {order && d.h > 1 && <span className="tile-order">{order.code}</span>}
                {s.status === 'running' && <div className="tile-progress"><div style={{ width: `${s.progress}%` }} /></div>}
              </div>
            );
          })}

          {ghost && (
            <div className={`ghost ${ghost.valid ? 'ok' : 'bad'}`}
              style={{
                left: GUTTER + ghost.x * CELL + 3, top: ghost.y * CELL + 3,
                width: ghost.w * CELL - 6, height: ghost.h * CELL - 6,
              }}>
              {ghost.valid ? '✓' : '✕'}
            </div>
          )}

          {pucks.map(({ o, x, y, done, waiting }) => (
            <div key={o.id} className={`puck${done ? ' done' : ''}${waiting ? ' waiting' : ''} prio-${o.priority}`}
              style={{ left: x, top: y }} title={`${o.code} — ${o.qty} units · ${o.location}`}>
              {o.code.replace('ORD-', '#')}
            </div>
          ))}
        </div>
      </div>

      {selected && (
        <div className="card mt" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 24 }}>{typeById(state, selected.typeId)?.icon}</span>
          <input className="mini-input" style={{ fontWeight: 700, width: 200 }} value={selected.name} readOnly={!canDesign}
            onChange={(e) => canDesign && api.updateStation(selected.id, { name: e.target.value }).catch(() => {})} />
          <Badge meta={STATION_STATUS[selected.status]} />
          <span className="muted" style={{ fontSize: 12.5 }}>
            {typeById(state, selected.typeId)?.name} · {selected.w ?? 1}×{selected.h ?? 1} cells at ({selected.x}, {selected.y}) · {selected.unitsToday} units today
            {selected.currentOrderId ? ` · working on ${orders.find((o) => o.id === selected.currentOrderId)?.code}` : ''}
          </span>
          <span style={{ flex: 1 }} />
          {canDesign && <button className="btn" onClick={() => setMoving(!moving)}>{moving ? 'Cancel move' : '✥ Move'}</button>}
          {canDesign && (
            <button className="btn btn-danger" disabled={!!selected.currentOrderId}
              onClick={() => window.confirm(`Dismantle ${selected.name}? Its measured-pace history is lost.`) &&
                api.removeStation(selected.id).then(() => setSelectedId(null)).catch((e) => setError(e.message))}>
              Dismantle
            </button>
          )}
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="muted" style={{ fontSize: 12 }}>
            Serves:{!selected.servesWorkflowIds?.length && <b style={{ color: 'var(--ink-2)' }}> every line</b>}
          </span>
          {workflows.map((w) => {
            const on = selected.servesWorkflowIds?.includes(w.id);
            return (
              <button key={w.id} className={`chip${on ? ' active' : ''}`} style={{ padding: '2px 10px', fontSize: 11.5 }}
                disabled={!canDesign}
                title={canDesign ? 'Toggle whether this station accepts work from this line' : 'manager role required'}
                onClick={() => {
                  const cur = selected.servesWorkflowIds ?? [];
                  const next = on ? cur.filter((id) => id !== w.id) : [...cur, w.id];
                  api.updateStation(selected.id, { servesWorkflowIds: next }).catch((e) => setError(e.message));
                }}>
                {on ? '✓ ' : ''}{w.name}
              </button>
            );
          })}
          <span className="muted" style={{ fontSize: 11 }}>
            (none selected = accepts work from every line; a station bound to a nested workflow also serves lines that contain it)
          </span>
        </div>
        </div>
      )}
    </>
  );
}
