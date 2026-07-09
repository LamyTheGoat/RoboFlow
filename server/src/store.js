// In-memory factory state with JSON snapshot persistence.
// A production deployment would back this with a real database; the shape of
// `state` is the contract the rest of the app (and the WebSocket feed) relies on.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSeedState, STATE_VERSION } from './seed.js';

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
const SNAPSHOT_FILE = path.join(DATA_DIR, 'state.json');
const MAX_EVENTS = 300;
const MAX_ALERTS = 200;
const MAX_HISTORY = 360; // throughput samples

export const state = loadState();

function loadState() {
  try {
    if (process.env.FRESH_STATE !== '1' && fs.existsSync(SNAPSHOT_FILE)) {
      const snapshot = JSON.parse(fs.readFileSync(SNAPSHOT_FILE, 'utf8'));
      if (snapshot.version === STATE_VERSION) return snapshot;
      console.warn(`Snapshot is schema v${snapshot.version ?? 1}, expected v${STATE_VERSION} — reseeding`);
    }
  } catch (err) {
    console.warn('Could not load snapshot, reseeding:', err.message);
  }
  return buildSeedState();
}

export function persist() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify(state));
  } catch (err) {
    console.warn('Snapshot write failed:', err.message);
  }
}

let seq = Date.now() % 1e9;
export function nextId(prefix) {
  return `${prefix}_${(seq++).toString(36)}`;
}

// ---- pubsub ----------------------------------------------------------------
const listeners = new Set();
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export function emit(message) {
  for (const fn of listeners) fn(message);
}

// ---- shared mutations ------------------------------------------------------
export function logEvent(type, source, message) {
  const event = { id: nextId('evt'), ts: Date.now(), type, source, message };
  state.events.unshift(event);
  if (state.events.length > MAX_EVENTS) state.events.length = MAX_EVENTS;
  emit({ type: 'event', event });
  return event;
}

export function raiseAlert(severity, source, message) {
  const alert = {
    id: nextId('alr'),
    ts: Date.now(),
    severity, // info | warning | serious | critical
    source,
    message,
    acknowledged: false,
  };
  state.alerts.unshift(alert);
  if (state.alerts.length > MAX_ALERTS) state.alerts.length = MAX_ALERTS;
  emit({ type: 'alert', alert });
  logEvent('alert', source, `[${severity}] ${message}`);
  return alert;
}

export function recordThroughput(units) {
  const now = Date.now();
  const bucket = Math.floor(now / 60000) * 60000; // per-minute buckets
  const history = state.metrics.throughputHistory;
  const last = history[history.length - 1];
  if (last && last.ts === bucket) last.units += units;
  else {
    history.push({ ts: bucket, units });
    if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY);
  }
  state.metrics.unitsToday += units;
}

export function findStation(id) {
  return state.stations.find((s) => s.id === id);
}
export function findRobot(id) {
  return state.robots.find((r) => r.id === id);
}
export function findOrder(id) {
  return state.orders.find((o) => o.id === id);
}
