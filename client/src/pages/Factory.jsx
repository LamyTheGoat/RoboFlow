import { useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import { Badge, STATION_STATUS, typeById } from '../ui.jsx';

const CELL = 64;
const GUTTER = 110; // warehouse / dispatch zones flanking the grid

export function Factory({ state }) {
  const { stations, orders, workflows, stationTypes, now } = state;
  const grid = state.factory.grid ?? { w: 20, h: 12 };
  const [mode, setMode] = useState('select'); // select | remove | place:<typeId>
  const [selectedId, setSelectedId] = useState(null);
  const [moving, setMoving] = useState(false);
  const [wfId, setWfId] = useState(workflows[0]?.id ?? '');
  const [error, setError] = useState(null);
  const boardRef = useRef(null);

  const selected = stations.find((s) => s.id === selectedId) ?? null;
  const wf = workflows.find((w) => w.id === wfId);

  const boardW = GUTTER * 2 + grid.w * CELL;
  const boardH = grid.h * CELL;
  const cellCenter = (s) => ({ x: GUTTER + s.x * CELL + CELL / 2, y: s.y * CELL + CELL / 2 });

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
          out.push({ o, x: boardW - GUTTER / 2 + ((shipped % 2) * 26 - 13), y: 40 + Math.floor(shipped / 2) * 30, done: true });
          shipped++;
        }
        continue;
      }
      const st = stations.find((s) => s.currentOrderId === o.id);
      if (st) {
        const c = cellCenter(st);
        out.push({ o, x: c.x, y: c.y + CELL / 2 + 4 });
      } else {
        out.push({ o, x: GUTTER / 2 + ((staged % 2) * 26 - 13), y: 40 + Math.floor(staged / 2) * 30, waiting: true });
        staged++;
      }
    }
    return out;
  }, [orders, stations, now]);

  async function onBoardClick(e) {
    const rect = boardRef.current.getBoundingClientRect();
    const px = e.clientX - rect.left - GUTTER;
    const py = e.clientY - rect.top;
    const x = Math.floor(px / CELL);
    const y = Math.floor(py / CELL);
    if (x < 0 || y < 0 || x >= grid.w || y >= grid.h) return;
    const hit = stations.find((s) => s.x === x && s.y === y);
    setError(null);
    try {
      if (mode.startsWith('place:')) {
        if (hit) throw new Error('that spot is occupied');
        await api.placeStation({ typeId: mode.slice(6), x, y });
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
        {stationTypes.map((t) => (
          <button key={t.id} className={`chip${mode === `place:${t.id}` ? ' active' : ''}`}
            title={t.description}
            onClick={() => setMode(mode === `place:${t.id}` ? 'select' : `place:${t.id}`)}>
            {t.icon} {t.name}
          </button>
        ))}
        <button className={`chip${mode === 'remove' ? ' active' : ''}`} onClick={() => setMode(mode === 'remove' ? 'select' : 'remove')}>🗑 Remove</button>
        <span style={{ flex: 1 }} />
        <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          show route
          <select value={wfId} onChange={(e) => setWfId(e.target.value)}>
            <option value="">— none —</option>
            {workflows.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </label>
      </div>

      {mode.startsWith('place:') && (
        <div className="hint-bar">Click an empty cell to install a {typeById(state, mode.slice(6))?.icon} <b>{typeById(state, mode.slice(6))?.name}</b>. It becomes a real station immediately.</div>
      )}
      {mode === 'remove' && <div className="hint-bar warn">Click a station to dismantle it (busy stations refuse).</div>}
      {moving && <div className="hint-bar">Click an empty cell to move <b>{selected?.name}</b> there.</div>}
      {missingSteps.length > 0 && (
        <div className="hint-bar warn">
          ⚠ Route incomplete — no station can do: {missingSteps.map((s) => `${s.icon} ${s.name}`).join(', ')}. Place one from the palette.
        </div>
      )}

      <div className="board-scroll card" style={{ padding: 10 }}>
        <div className="board" ref={boardRef} style={{ width: boardW, height: boardH }} onClick={onBoardClick}>
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
            return (
              <div key={s.id}
                className={`tile status-${s.status}${selectedId === s.id ? ' selected' : ''}`}
                style={{ left: GUTTER + s.x * CELL + 3, top: s.y * CELL + 3, width: CELL - 6, height: CELL - 6 }}
                title={`${s.name} — ${STATION_STATUS[s.status].label}${order ? ` · ${order.code}` : ''}`}>
                <span className="tile-icon">{type?.icon}</span>
                <span className="tile-name">{s.name}</span>
                {s.status === 'running' && <div className="tile-progress"><div style={{ width: `${s.progress}%` }} /></div>}
              </div>
            );
          })}

          {pucks.map(({ o, x, y, done, waiting }) => (
            <div key={o.id} className={`puck${done ? ' done' : ''}${waiting ? ' waiting' : ''} prio-${o.priority}`}
              style={{ left: x, top: y }} title={`${o.code} — ${o.qty} units · ${o.location}`}>
              {o.code.replace('ORD-', '#')}
            </div>
          ))}
        </div>
      </div>

      {selected && (
        <div className="card mt" style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 24 }}>{typeById(state, selected.typeId)?.icon}</span>
          <input className="mini-input" style={{ fontWeight: 700, width: 200 }} value={selected.name}
            onChange={(e) => api.updateStation(selected.id, { name: e.target.value }).catch(() => {})} />
          <Badge meta={STATION_STATUS[selected.status]} />
          <span className="muted" style={{ fontSize: 12.5 }}>
            {typeById(state, selected.typeId)?.name} · ({selected.x}, {selected.y}) · {selected.unitsToday} units today
            {selected.currentOrderId ? ` · working on ${orders.find((o) => o.id === selected.currentOrderId)?.code}` : ''}
          </span>
          <span style={{ flex: 1 }} />
          <button className="btn" onClick={() => setMoving(!moving)}>{moving ? 'Cancel move' : '✥ Move'}</button>
          <button className="btn btn-danger" disabled={!!selected.currentOrderId}
            onClick={() => api.removeStation(selected.id).then(() => setSelectedId(null)).catch((e) => setError(e.message))}>
            Dismantle
          </button>
        </div>
      )}
    </>
  );
}
