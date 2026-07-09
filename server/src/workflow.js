// Order workflow engine: dispatches queued orders to matching idle stations,
// consumes materials, and advances orders when a station reports a finished
// stage. Orders carry a snapshot of their (flattened) workflow, so editing a
// workflow or station type never disturbs orders already on the floor.
import {
  state,
  findOrder,
  logEvent,
  raiseAlert,
  recordThroughput,
  nextId,
} from './store.js';
import { typeServes, buildOrderStages } from './catalog.js';

const PRIORITY_RANK = { high: 0, normal: 1, low: 2 };

export function stationOfOrder(order) {
  return state.stations.find((s) => s.currentOrderId === order.id) ?? null;
}

// Where is this order physically right now? Shown as "location" in the UI.
export function orderLocation(order) {
  if (order.status === 'completed') return 'Dispatch — shipped';
  const st = stationOfOrder(order);
  if (st) return st.name;
  if (order.status === 'on_hold') return 'Warehouse — awaiting material';
  if (order.stageIndex === 0 && order.stages[0]?.status === 'pending') return 'Warehouse — staged';
  return `Buffer before ${order.stages[order.stageIndex]?.name ?? '?'}`;
}

// Total material need = sum over the order's stage snapshot.
function materialNeeds(order) {
  const needs = new Map();
  for (const stage of order.stages) {
    for (const inp of stage.inputs ?? []) {
      needs.set(inp.sku, +((needs.get(inp.sku) ?? 0) + inp.qty * order.qty).toFixed(1));
    }
  }
  return needs;
}

function tryConsumeMaterials(order) {
  if (order.materialsConsumed) return true;
  const needs = materialNeeds(order);
  const missing = [];
  for (const [sku, amount] of needs) {
    const item = state.inventory.find((i) => i.sku === sku);
    if (!item || item.qty < amount) missing.push(item?.name ?? sku);
  }
  if (missing.length) {
    if (order.status !== 'on_hold') {
      order.status = 'on_hold';
      raiseAlert('serious', order.code, `Material shortage: ${missing.join(', ')} — order on hold`);
    }
    return false;
  }
  for (const [sku, amount] of needs) {
    const item = state.inventory.find((i) => i.sku === sku);
    item.qty = +(item.qty - amount).toFixed(1);
    item.consumedToday = +(item.consumedToday + amount).toFixed(1);
    if (item.qty <= item.reorderPoint && item.qty + amount > item.reorderPoint) {
      raiseAlert('warning', 'warehouse', `${item.name} below reorder point (${item.qty} ${item.unit} left)`);
    }
  }
  order.materialsConsumed = true;
  logEvent('warehouse', order.code, `Materials picked from warehouse for ${order.qty} units`);
  return true;
}

// Assign queued/held orders to idle stations. Called on every simulator tick
// and after any state-changing ingest/command.
export function dispatchOrders() {
  const waiting = state.orders
    .filter((o) => (o.status === 'queued' || o.status === 'on_hold' || o.status === 'in_progress') &&
      o.stageIndex < o.stages.length &&
      o.stages[o.stageIndex].status !== 'active')
    .sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.dueDate - b.dueDate);

  for (const order of waiting) {
    if (!tryConsumeMaterials(order)) continue;
    if (order.status === 'on_hold') order.status = 'queued';
    const stage = order.stages[order.stageIndex];
    const station = state.stations.find((s) => s.status === 'idle' && typeServes(s.typeId, stage.typeId));
    if (!station) {
      if (!stage.noStationAlerted && !state.stations.some((s) => typeServes(s.typeId, stage.typeId))) {
        stage.noStationAlerted = true;
        raiseAlert('warning', order.code, `No station on the floor can perform "${stage.name}" — place one in the Factory designer`);
      }
      continue;
    }
    station.status = 'running';
    station.currentOrderId = order.id;
    station.progress = 0;
    station.lastSeen = Date.now();
    order.status = 'in_progress';
    stage.status = 'active';
    stage.startedAt = Date.now();
    stage.stationId = station.id;
    for (const r of state.robots) if (r.stationId === station.id && r.status !== 'fault') r.status = 'working';
    logEvent('workflow', station.name, `${order.code} started ${stage.name} (${order.qty} units)`);
  }
}

// Rolling planned-vs-actual pace per station, keyed by the leaf step type it
// performed (a composite station runs several step types, tracked separately).
// Consistent drift beyond tolerance is often the first sign of tool wear or a
// feeding problem, so it raises a warning the manager can act on.
const DRIFT_RATIO = 1.3; // alert when ≥30% slower than designed
const RECOVER_RATIO = 1.15;

function recordActual(station, stage, order) {
  if (!stage.startedAt || !order.qty) return;
  const secPerUnit = (Date.now() - stage.startedAt) / 1000 / order.qty;
  station.actualByType ??= {};
  const rec = (station.actualByType[stage.typeId] ??= { ema: null, n: 0, planned: null, last: null, driftAlerted: false });
  rec.n += 1;
  rec.last = +secPerUnit.toFixed(2);
  rec.planned = stage.timeSecPerUnit; // reference from the order's design snapshot
  rec.ema = +(rec.ema == null ? secPerUnit : rec.ema * 0.7 + secPerUnit * 0.3).toFixed(2);

  const ratio = rec.planned > 0 ? rec.ema / rec.planned : 1;
  if (rec.n >= 3 && ratio >= DRIFT_RATIO && !rec.driftAlerted) {
    rec.driftAlerted = true;
    raiseAlert('warning', station.name,
      `Running ${Math.round((ratio - 1) * 100)}% slower than designed on ${stage.name} ` +
      `(planned ${rec.planned}s, measured ≈${rec.ema}s per unit) — check tooling/material feed`);
  } else if (rec.driftAlerted && ratio <= RECOVER_RATIO) {
    rec.driftAlerted = false;
    logEvent('station', station.name, `${stage.name} pace back within tolerance (≈${rec.ema}s per unit)`);
  }
}

// A station reported its current stage batch finished.
export function completeStage(station) {
  const order = findOrder(station.currentOrderId);
  station.currentOrderId = null;
  station.progress = 0;
  station.status = station.status === 'running' ? 'idle' : station.status;
  for (const r of state.robots) if (r.stationId === station.id && r.status === 'working') r.status = 'idle';
  if (!order) return;

  const stage = order.stages[order.stageIndex];
  stage.status = 'done';
  stage.finishedAt = Date.now();
  recordActual(station, stage, order);
  station.unitsToday += order.qty;
  logEvent('workflow', station.name, `${order.code} finished ${stage.name}`);

  order.stageIndex += 1;
  if (order.stageIndex >= order.stages.length) {
    order.status = 'completed';
    order.completedAt = Date.now();
    recordThroughput(order.qty);
    logEvent('order', order.code, `Order completed — ${order.qty} units ready for dispatch`);
  }
  dispatchOrders();
}

let orderSeq = 1007;
export function createOrder({ projectId, customer, qty, priority = 'normal', dueInDays = 7 }) {
  const project = state.projects.find((p) => p.id === projectId);
  if (!project) throw new Error(`unknown project ${projectId}`);
  const stages = buildOrderStages(project.workflowId);
  if (!stages.length) throw new Error(`project ${project.name} has no runnable workflow assigned`);
  const now = Date.now();
  const order = {
    id: `ord_${orderSeq}`,
    code: `ORD-${orderSeq++}`,
    projectId,
    customer,
    qty,
    priority,
    status: 'queued',
    stageIndex: 0,
    stages,
    materialsConsumed: false,
    createdAt: now,
    dueDate: now + dueInDays * 24 * 60 * 60 * 1000,
    completedAt: null,
  };
  state.orders.unshift(order);
  logEvent('order', order.code, `New order: ${qty}× ${project.product} for ${customer}`);
  dispatchOrders();
  return order;
}

export function receiveDelivery(sku, qty) {
  const item = state.inventory.find((i) => i.sku === sku);
  if (!item) return;
  item.qty = Math.min(item.capacity, +(item.qty + qty).toFixed(1));
  logEvent('warehouse', 'goods-in', `Delivery received: +${qty} ${item.unit} ${item.name}`);
  dispatchOrders();
}

// ---- factory designer: placing real stations on the grid -----------------------
// Stations occupy a w×h rectangle of cells (footprint comes from the type and
// is snapshotted onto the station at install time).
function rectError(x, y, w, h, ignoreId = null) {
  const grid = state.factory.grid;
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x + w > grid.w || y + h > grid.h) {
    return 'the station would stick out of the factory floor';
  }
  const clash = state.stations.some((s) => s.id !== ignoreId &&
    x < s.x + (s.w ?? 1) && s.x < x + w &&
    y < s.y + (s.h ?? 1) && s.y < y + h);
  return clash ? 'that spot overlaps another station' : null;
}

export function placeStation({ typeId, name, x, y }) {
  const type = state.stationTypes.find((t) => t.id === typeId);
  if (!type) throw new Error(`unknown station type ${typeId}`);
  const w = type.w ?? 1;
  const h = type.h ?? 1;
  const err = rectError(x, y, w, h);
  if (err) throw new Error(err);

  const station = {
    id: nextId('st'),
    name: name?.trim() || `${type.name} ${state.stations.filter((s) => s.typeId === typeId).length + 1}`,
    typeId, x, y, w, h,
    status: 'idle',
    currentOrderId: null,
    progress: 0,
    utilization: 0,
    unitsToday: 0,
    lastSeen: Date.now(),
  };
  state.stations.push(station);
  state.robots.push({
    id: nextId('rb'),
    name: `${type.icon} ${station.name} Bot`,
    model: 'Generic 6-axis',
    stationId: station.id,
    status: 'idle',
    temperatureC: 34,
    toolWearPct: 0,
    cyclesTotal: 0,
    lastSeen: Date.now(),
  });
  logEvent('station', 'factory-designer', `${station.name} installed at (${x}, ${y})`);
  dispatchOrders();
  return station;
}

export function updateStation(stationId, { name, x, y }) {
  const station = state.stations.find((s) => s.id === stationId);
  if (!station) throw new Error(`unknown station ${stationId}`);
  if (name !== undefined && name.trim()) station.name = name.trim();
  if (x !== undefined && y !== undefined) {
    const err = rectError(x, y, station.w ?? 1, station.h ?? 1, stationId);
    if (err) throw new Error(err);
    station.x = x;
    station.y = y;
  }
  return station;
}

export function removeStation(stationId) {
  const station = state.stations.find((s) => s.id === stationId);
  if (!station) throw new Error(`unknown station ${stationId}`);
  if (station.currentOrderId) throw new Error('station is working on an order — stop it first');
  state.stations = state.stations.filter((s) => s.id !== stationId);
  state.robots = state.robots.filter((r) => r.stationId !== stationId);
  logEvent('station', 'factory-designer', `${station.name} removed from the floor`);
  return station;
}
