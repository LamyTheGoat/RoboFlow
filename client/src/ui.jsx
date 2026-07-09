import { useRef, useState } from 'react';

// ---- status metadata ---------------------------------------------------------
// Colors never carry state alone: every badge pairs an icon + label with the tone.
export const STATION_STATUS = {
  running: { label: 'Running', tone: 'good', icon: '▶' },
  idle: { label: 'Idle', tone: 'neutral', icon: '◦' },
  paused: { label: 'Paused', tone: 'warning', icon: '⏸' },
  stopped: { label: 'Stopped', tone: 'neutral', icon: '■' },
  fault: { label: 'Fault', tone: 'critical', icon: '⛔' },
  maintenance: { label: 'Maintenance', tone: 'serious', icon: '🛠' },
};

export const ROBOT_STATUS = {
  working: { label: 'Working', tone: 'good', icon: '▶' },
  idle: { label: 'Idle', tone: 'neutral', icon: '◦' },
  paused: { label: 'Paused', tone: 'warning', icon: '⏸' },
  fault: { label: 'Fault', tone: 'critical', icon: '⛔' },
  offline: { label: 'Offline', tone: 'neutral', icon: '○' },
};

export const ORDER_STATUS = {
  queued: { label: 'Queued', tone: 'neutral', icon: '◷' },
  in_progress: { label: 'In progress', tone: 'good', icon: '▶' },
  on_hold: { label: 'On hold', tone: 'serious', icon: '⏸' },
  completed: { label: 'Completed', tone: 'accent', icon: '✓' },
};

export const ALERT_SEVERITY = {
  info: { label: 'Info', tone: 'accent', icon: 'ℹ' },
  warning: { label: 'Warning', tone: 'warning', icon: '⚠' },
  serious: { label: 'Serious', tone: 'serious', icon: '▲' },
  critical: { label: 'Critical', tone: 'critical', icon: '⛔' },
};

export function Badge({ meta, children }) {
  return (
    <span className={`badge tone-${meta.tone}`}>
      <span className="badge-icon" aria-hidden>{meta.icon}</span>
      {children ?? meta.label}
    </span>
  );
}

// ---- formatting ----------------------------------------------------------------
export function timeAgo(ts, now = Date.now()) {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 10) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function fmtDate(ts) {
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function fmtClock(ts) {
  return new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

// ---- small viz pieces -----------------------------------------------------------
export function KpiTile({ label, value, sub, tone }) {
  return (
    <div className="kpi">
      <div className="kpi-label">{label}</div>
      <div className={`kpi-value${tone ? ` ink-${tone}` : ''}`}>{value}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  );
}

// Thin horizontal bar with rounded data end; optional marker (e.g. reorder point).
export function Bar({ value, max, markerAt, tone = 'accent' }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const marker = markerAt != null && max > 0 ? Math.min(100, (markerAt / max) * 100) : null;
  return (
    <div className="bar-track">
      <div className={`bar-fill tone-${tone}`} style={{ width: `${pct}%` }} />
      {marker != null && <div className="bar-marker" style={{ left: `${marker}%` }} title="Reorder point" />}
    </div>
  );
}

// Single-series line with hover crosshair + tooltip. `points`: [{ts, value}].
export function Sparkline({ points, height = 72, formatValue = (v) => `${v}` }) {
  const ref = useRef(null);
  const [hover, setHover] = useState(null);
  const W = 300;
  const H = 56;
  const PAD = 4;

  if (!points.length) return <div className="spark-empty">No data yet</div>;
  const max = Math.max(1, ...points.map((p) => p.value));
  const x = (i) => PAD + (i / Math.max(1, points.length - 1)) * (W - PAD * 2);
  const y = (v) => H - PAD - (v / max) * (H - PAD * 2);
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const area = `${path} L${x(points.length - 1).toFixed(1)},${H - PAD} L${x(0).toFixed(1)},${H - PAD} Z`;

  function onMove(e) {
    const rect = ref.current.getBoundingClientRect();
    const rel = (e.clientX - rect.left) / rect.width;
    const i = Math.round(rel * (points.length - 1));
    if (i >= 0 && i < points.length) setHover({ i, px: e.clientX - rect.left });
  }

  return (
    <div className="spark-wrap" ref={ref} style={{ height }} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="spark-svg">
        <path d={area} className="spark-area" />
        <path d={path} className="spark-line" vectorEffect="non-scaling-stroke" />
        {hover && (
          <line x1={x(hover.i)} x2={x(hover.i)} y1={PAD} y2={H - PAD} className="spark-crosshair" vectorEffect="non-scaling-stroke" />
        )}
      </svg>
      {hover && (
        <div className="spark-tip" style={{ left: Math.min(Math.max(hover.px, 40), ref.current.clientWidth - 40) }}>
          <div className="spark-tip-value">{formatValue(points[hover.i].value)}</div>
          <div className="spark-tip-time">{fmtClock(points[hover.i].ts)}</div>
        </div>
      )}
    </div>
  );
}

// Workflow stage pips for an order: done / active / pending.
export function StagePips({ order, stageNames }) {
  return (
    <div className="pips" title={order.stages.map((s) => `${stageNames[s.stage]}: ${s.status}`).join('\n')}>
      {order.stages.map((s, i) => (
        <span key={i} className={`pip pip-${s.status}`}>
          <span className="pip-dot" />
          <span className="pip-name">{stageNames[s.stage]}</span>
        </span>
      ))}
    </div>
  );
}
