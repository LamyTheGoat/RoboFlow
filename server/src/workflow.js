// Order workflow engine: dispatches queued orders to matching idle stations,
// consumes materials, and advances orders when a station reports a finished
// stage. Robots/stations only report telemetry (see ingest.js); everything
// about *orders* is decided here, on the server.
import {
  state,
  findStation,
  findOrder,
  logEvent,
  raiseAlert,
  recordThroughput,
} from './store.js';

const PRIORITY_RANK = { high: 0, normal: 1, low: 2 };

export function currentStageOf(order) {
  return order.stages[order.stageIndex]?.stage ?? null;
}

export function stationOfOrder(order) {
  return state.stations.find((s) => s.currentOrderId === order.id) ?? null;
}

// Where is this order physically right now? Shown as "location" in the UI.
export function orderLocation(order) {
  if (order.status === 'completed') return 'Dispatch — shipped';
  const st = stationOfOrder(order);
  if (st) return st.name;
  if (order.status === 'on_hold') return 'Warehouse — awaiting material';
  if (order.stageIndex === 0 && order.stages[0].status === 'pending') return 'Warehouse — staged';
  return `Buffer before ${state.stageNames[currentStageOf(order)] ?? '?'}`;
}

function tryConsumeMaterials(order) {
  if (order.materialsConsumed) return true;
  const project = state.projects.find((p) => p.id === order.projectId);
  const missing = [];
  for (const [sku, perUnit] of Object.entries(project.bom)) {
    const item = state.inventory.find((i) => i.sku === sku);
    if (!item || item.qty < perUnit * order.qty) missing.push(item?.name ?? sku);
  }
  if (missing.length) {
    if (order.status !== 'on_hold') {
      order.status = 'on_hold';
      raiseAlert('serious', order.code, `Material shortage: ${missing.join(', ')} — order on hold`);
    }
    return false;
  }
  for (const [sku, perUnit] of Object.entries(project.bom)) {
    const item = state.inventory.find((i) => i.sku === sku);
    const amount = +(perUnit * order.qty).toFixed(1);
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
    const stage = currentStageOf(order);
    const station = state.stations.find((s) => s.stage === stage && s.status === 'idle');
    if (!station) continue;
    station.status = 'running';
    station.currentOrderId = order.id;
    station.progress = 0;
    station.lastSeen = Date.now();
    order.status = 'in_progress';
    const stageEntry = order.stages[order.stageIndex];
    stageEntry.status = 'active';
    stageEntry.startedAt = Date.now();
    for (const r of state.robots) if (r.stationId === station.id && r.status !== 'fault') r.status = 'working';
    logEvent('workflow', station.name, `${order.code} started ${state.stageNames[stage]} (${order.qty} units)`);
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

  const stageEntry = order.stages[order.stageIndex];
  stageEntry.status = 'done';
  stageEntry.finishedAt = Date.now();
  station.unitsToday += order.qty;
  logEvent('workflow', station.name, `${order.code} finished ${state.stageNames[stageEntry.stage]}`);

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
    stages: project.workflow.map((stage) => ({ stage, status: 'pending', startedAt: null, finishedAt: null })),
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
