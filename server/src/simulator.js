// Factory floor simulator. It stands in for the real plant: every tick it
// pushes the same telemetry messages a robot/PLC gateway would POST to
// /api/ingest, so the whole pipeline (ingest → workflow → WebSocket) is
// exercised exactly as it would be in production.
import { state, logEvent, raiseAlert } from './store.js';
import { applyTelemetry } from './ingest.js';
import { dispatchOrders, createOrder, receiveDelivery } from './workflow.js';

const TICK_MS = 2000;
const CUSTOMERS = ['Nordwerk GmbH', 'Meridian Logistics', 'HydroParts AS', 'Vektor Automation', 'BalticFluid OÜ', 'Callisto Systems'];

const chance = (p) => Math.random() < p;
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// Each simulated station has a hidden pace factor (0.75 = 25% faster than
// designed, 1.45 = 45% slower) so planned-vs-actual tracking has something
// real to measure — slow outliers will trip the drift warning, as a worn
// tool would on a real floor.
const paceFactor = new Map();
const paceOf = (id) => {
  if (!paceFactor.has(id)) paceFactor.set(id, 0.75 + Math.random() * 0.7);
  return paceFactor.get(id);
};

function tick() {
  // Rolling utilization (EMA over ~1 hour of ticks).
  for (const station of state.stations) {
    station.utilization = +(station.utilization * 0.985 + (station.status === 'running' ? 100 : 0) * 0.015).toFixed(1);
  }

  // 1. Stations report progress on their current batch. The pace comes from
  // the station type's designed time-per-unit and the batch size.
  for (const station of state.stations) {
    if (station.status !== 'running' || !station.currentOrderId) continue;
    const order = state.orders.find((o) => o.id === station.currentOrderId);
    const stage = order?.stages[order.stageIndex];
    const batchSec = Math.max(4, (stage?.timeSecPerUnit ?? 4) * (order?.qty ?? 10) * paceOf(station.id));
    const advance = ((TICK_MS / 1000) / batchSec) * 100 * (0.7 + Math.random() * 0.6);
    const progress = station.progress + advance;
    if (progress >= 100) {
      applyTelemetry({ kind: 'stage.completed', stationId: station.id });
    } else {
      applyTelemetry({ kind: 'station.progress', stationId: station.id, progress });
    }
  }

  // 2. Robots report telemetry (temperature drifts with load, tools wear).
  for (const robot of state.robots) {
    const working = robot.status === 'working';
    const target = working ? 55 + Math.random() * 18 : 34;
    applyTelemetry({
      kind: 'robot.telemetry',
      robotId: robot.id,
      temperatureC: robot.temperatureC + (target - robot.temperatureC) * 0.15 + (Math.random() - 0.5),
      toolWearPct: working ? robot.toolWearPct + Math.random() * 0.15 : robot.toolWearPct,
      cyclesDelta: working ? Math.round(1 + Math.random() * 3) : 0,
    });
    if (robot.toolWearPct >= 92) {
      applyTelemetry({ kind: 'robot.telemetry', robotId: robot.id, toolWearPct: 5 });
      logEvent('maintenance', robot.name, 'Tool changed by maintenance crew');
    }
  }

  // 3. Rare floor incidents: a running station faults.
  if (chance(0.012)) {
    const running = state.stations.filter((s) => s.status === 'running');
    if (running.length) {
      const st = pick(running);
      applyTelemetry({
        kind: 'station.status',
        stationId: st.id,
        status: 'fault',
        reason: pick(['Torque limit exceeded on axis 3', 'Part jam detected at feeder', 'Vision check failed 3× in a row', 'Safety curtain interrupted']),
      });
    }
  }

  // 4. Faulted stations get fixed by the (simulated) maintenance crew.
  for (const station of state.stations) {
    if (station.status === 'fault' && chance(0.06)) {
      applyTelemetry({ kind: 'station.status', stationId: station.id, status: station.currentOrderId ? 'running' : 'idle' });
    }
  }

  // 5. Keep the plant loaded: new customer orders arrive.
  const open = state.orders.filter((o) => o.status !== 'completed').length;
  if (open < 7 && chance(0.05)) {
    createOrder({
      projectId: pick(state.projects).id,
      customer: pick(CUSTOMERS),
      qty: 5 + Math.floor(Math.random() * 16),
      priority: pick(['normal', 'normal', 'high', 'low']),
      dueInDays: 3 + Math.floor(Math.random() * 9),
    });
  }

  // 6. Goods-in: deliveries replenish whatever purchasable material is lowest.
  // Half products are made on the floor, never bought.
  if (chance(0.03)) {
    const purchasable = state.inventory.filter((i) => i.category !== 'Half product');
    const lowest = purchasable.sort((a, b) => a.qty / a.capacity - b.qty / b.capacity)[0];
    if (lowest) receiveDelivery(lowest.sku, Math.round(lowest.capacity * (0.2 + Math.random() * 0.3)));
  }

  dispatchOrders();
}

export function startSimulator() {
  logEvent('system', 'simulator', 'Floor simulator connected — streaming telemetry');
  dispatchOrders();
  setInterval(tick, TICK_MS);
}
