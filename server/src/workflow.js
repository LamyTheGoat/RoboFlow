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
import { typeServes, buildOrderStages, collectWorkflowIds } from './catalog.js';

const PRIORITY_RANK = { high: 0, normal: 1, low: 2 };

export function stationOfOrder(order) {
  return state.stations.find((s) => s.currentOrderId === order.id) ?? null;
}

// A station with an empty binding list serves every line; a bound station only
// serves orders whose (root or nested) workflow is in its list.
export function stationServesOrder(station, order) {
  if (!station.servesWorkflowIds?.length) return true;
  const ids = order.workflowIds ?? [];
  return station.servesWorkflowIds.some((id) => ids.includes(id));
}

// Where is this order physically right now? Shown as "location" in the UI.
export function orderLocation(order) {
  if (order.status === 'cancelled') return 'Cancelled';
  if (order.status === 'completed') return 'Dispatch — shipped';
  const st = stationOfOrder(order);
  if (st) return st.name;
  if (order.status === 'on_hold') return 'Warehouse — awaiting material';
  if (order.stageIndex === 0 && order.stages[0]?.status === 'pending') return 'Warehouse — staged';
  return `Buffer before ${order.stages[order.stageIndex]?.name ?? '?'}`;
}

// ---- WIP reservations -----------------------------------------------------------
// When a stage produces a half product that a LATER stage of the same order
// will consume, that quantity is reserved for the order — another order can't
// snatch it out of the buffer. Reserved stock is still part of item.qty; the
// reservation only limits who may consume it.
function reservationsOf(orderId) {
  state.reservations ??= {};
  return (state.reservations[orderId] ??= {});
}

export function totalReserved(sku, exceptOrderId = null) {
  let total = 0;
  for (const [orderId, skus] of Object.entries(state.reservations ?? {})) {
    if (orderId !== exceptOrderId) total += skus[sku] ?? 0;
  }
  return +total.toFixed(2);
}

// Stock this order may use: free stock plus its own reservation.
function availableFor(item, orderId) {
  return +(item.qty - totalReserved(item.sku, orderId)).toFixed(2);
}

function releaseReservations(orderId) {
  if (state.reservations?.[orderId]) delete state.reservations[orderId];
}

// Materials are consumed per stage, right when the stage starts, and each
// stage's outputs land in the warehouse as half products (WIP) when it
// finishes — so the output of one step literally feeds the input of the next
// (or of any other order/line that needs the same half product).
function tryConsumeStageInputs(order, stage) {
  if (stage.inputsConsumed) return true;
  const missing = [];
  for (const inp of stage.inputs ?? []) {
    const item = state.inventory.find((i) => i.sku === inp.sku);
    if (!item || availableFor(item, order.id) < inp.qty * order.qty) missing.push(item?.name ?? inp.sku);
  }
  if (missing.length) {
    if (order.status !== 'on_hold') {
      order.status = 'on_hold';
      raiseAlert('serious', order.code, `Waiting for material at ${stage.name}: ${missing.join(', ')} — order on hold`);
    }
    return false;
  }
  for (const inp of stage.inputs ?? []) {
    const item = state.inventory.find((i) => i.sku === inp.sku);
    const amount = +(inp.qty * order.qty).toFixed(1);
    item.qty = +(item.qty - amount).toFixed(1);
    item.consumedToday = +(item.consumedToday + amount).toFixed(1);
    const res = reservationsOf(order.id);
    if (res[inp.sku]) {
      res[inp.sku] = +Math.max(0, res[inp.sku] - amount).toFixed(2);
      if (!res[inp.sku]) delete res[inp.sku];
    }
    if (item.reorderPoint > 0 && item.qty <= item.reorderPoint && item.qty + amount > item.reorderPoint) {
      raiseAlert('warning', 'warehouse', `${item.name} below reorder point (${item.qty} ${item.unit} left)`);
    }
  }
  stage.inputsConsumed = true;
  if ((stage.inputs ?? []).length) {
    logEvent('warehouse', order.code, `Materials issued for ${stage.name} (${order.qty} units)`);
  }
  return true;
}

function produceStageOutputs(order, stage, station) {
  const made = [];
  for (const out of stage.outputs ?? []) {
    const item = state.inventory.find((i) => i.sku === out.sku);
    if (!item) continue;
    const amount = +(out.qty * order.qty).toFixed(1);
    const before = item.qty;
    item.qty = Math.min(item.capacity, +(item.qty + amount).toFixed(1));
    const added = +(item.qty - before).toFixed(1);
    made.push(`${amount} ${item.unit} ${item.name}`);

    // Reserve for this order whatever its own later stages will need.
    const futureNeed = order.stages
      .slice(order.stageIndex + 1)
      .filter((s) => s.status === 'pending')
      .reduce((sum, s) => sum + (s.inputs ?? []).filter((i) => i.sku === out.sku).reduce((a, i) => a + i.qty * order.qty, 0), 0);
    const res = reservationsOf(order.id);
    const already = res[out.sku] ?? 0;
    const reserve = +Math.min(added, Math.max(0, futureNeed - already)).toFixed(2);
    if (reserve > 0) res[out.sku] = +(already + reserve).toFixed(2);
  }
  if (made.length) logEvent('warehouse', station.name, `Produced ${made.join(', ')} → stock`);
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
    const stage = order.stages[order.stageIndex];
    const canServe = (s) => typeServes(s.typeId, stage.typeId) && stationServesOrder(s, order);
    const station = state.stations.find((s) => s.status === 'idle' && canServe(s));
    if (!station) {
      if (!stage.noStationAlerted && !state.stations.some(canServe)) {
        stage.noStationAlerted = true;
        raiseAlert('warning', order.code, `No station available for "${stage.name}" on this line — place one in the Factory designer or adjust station↔workflow bindings`);
      }
      continue;
    }
    if (!tryConsumeStageInputs(order, stage)) continue;
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
  produceStageOutputs(order, stage, station);
  station.unitsToday += order.qty;
  logEvent('workflow', station.name, `${order.code} finished ${stage.name}`);

  order.stageIndex += 1;
  if (order.stageIndex >= order.stages.length) {
    order.status = 'completed';
    order.completedAt = Date.now();
    releaseReservations(order.id);
    recordThroughput(order.qty);
    logEvent('order', order.code, `Order completed — ${order.qty} units ready for dispatch`);
  }
  dispatchOrders();
}

export function cancelOrder(orderId, issuedBy = 'operator') {
  const order = findOrder(orderId);
  if (!order) throw new Error(`unknown order ${orderId}`);
  if (order.status === 'completed' || order.status === 'cancelled') throw new Error(`order is already ${order.status}`);

  const station = stationOfOrder(order);
  if (station) {
    station.currentOrderId = null;
    station.progress = 0;
    if (station.status === 'running') station.status = 'idle';
    for (const r of state.robots) if (r.stationId === station.id && r.status === 'working') r.status = 'idle';
  }
  const stage = order.stages[order.stageIndex];
  if (stage?.status === 'active') {
    stage.status = 'pending';
    stage.startedAt = null;
    stage.stationId = null;
  }
  order.status = 'cancelled';
  order.cancelledAt = Date.now();
  releaseReservations(order.id);
  const consumedAny = order.stages.some((s) => s.inputsConsumed);
  logEvent('order', issuedBy, `${order.code} cancelled${consumedAny ? ' (materials already issued stay consumed)' : ''}`);
  dispatchOrders();
  return order;
}

// Rebuild a waiting order's routing from the project's CURRENT workflow —
// the escape hatch after fixing a design. Progress restarts from step one.
export function rerouteOrder(orderId, issuedBy = 'operator') {
  const order = findOrder(orderId);
  if (!order) throw new Error(`unknown order ${orderId}`);
  if (order.status !== 'queued' && order.status !== 'on_hold') {
    throw new Error('only waiting orders (queued / on hold) can be rerouted — stop or let the current step finish first');
  }
  const project = state.projects.find((p) => p.id === order.projectId);
  const stages = buildOrderStages(project.workflowId);
  if (!stages.length) throw new Error(`project ${project.name} has no runnable workflow assigned`);
  order.stages = stages;
  order.stageIndex = 0;
  order.status = 'queued';
  order.workflowIds = [...collectWorkflowIds(project.workflowId)];
  releaseReservations(order.id);
  logEvent('order', issuedBy, `${order.code} rerouted to the current "${state.workflows.find((w) => w.id === project.workflowId)?.name}" design`);
  dispatchOrders();
  return order;
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
    workflowIds: [...collectWorkflowIds(project.workflowId)],
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

export function placeStation({ typeId, name, x, y, rotated = false }) {
  const type = state.stationTypes.find((t) => t.id === typeId);
  if (!type) throw new Error(`unknown station type ${typeId}`);
  const w = rotated ? (type.h ?? 1) : (type.w ?? 1);
  const h = rotated ? (type.w ?? 1) : (type.h ?? 1);
  const err = rectError(x, y, w, h);
  if (err) throw new Error(err);

  const station = {
    id: nextId('st'),
    name: name?.trim() || `${type.name} ${state.stations.filter((s) => s.typeId === typeId).length + 1}`,
    typeId, x, y, w, h,
    servesWorkflowIds: [], // empty = serves every line
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

export function updateStation(stationId, { name, x, y, servesWorkflowIds }) {
  const station = state.stations.find((s) => s.id === stationId);
  if (!station) throw new Error(`unknown station ${stationId}`);
  if (name !== undefined && name.trim()) station.name = name.trim();
  if (x !== undefined && y !== undefined) {
    const err = rectError(x, y, station.w ?? 1, station.h ?? 1, stationId);
    if (err) throw new Error(err);
    station.x = x;
    station.y = y;
  }
  if (servesWorkflowIds !== undefined) {
    if (!Array.isArray(servesWorkflowIds)) throw new Error('servesWorkflowIds must be an array');
    for (const id of servesWorkflowIds) {
      if (!state.workflows.some((w) => w.id === id)) throw new Error(`unknown workflow ${id}`);
    }
    station.servesWorkflowIds = [...new Set(servesWorkflowIds)];
    logEvent('designer', 'factory', `${station.name} now serves ${station.servesWorkflowIds.length ? station.servesWorkflowIds.length + ' selected line(s)' : 'every line'}`);
    dispatchOrders();
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
