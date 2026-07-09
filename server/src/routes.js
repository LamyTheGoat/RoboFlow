import { Router } from 'express';
import { state, nextId, logEvent } from './store.js';
import { applyTelemetry } from './ingest.js';
import { stationCommand, emergencyStop, acknowledgeAlert, setOrderPriority, ackCommand } from './commands.js';
import { requireUser, requireManager, gatewayGuard } from './auth.js';
import {
  createOrder, orderLocation, dispatchOrders,
  placeStation, updateStation, removeStation,
  cancelOrder, rerouteOrder, totalReserved, releaseBatch,
} from './workflow.js';
import {
  flattenWorkflow, workflowTotals, measuredSecPerUnit,
  validateWorkflowSteps, validateTypeChildren,
} from './catalog.js';

// Snapshot sent to clients (REST and WebSocket) — raw state plus the
// computed fields the UI needs, minus sim-internal ones.
export function serializeState() {
  return {
    ...state,
    now: Date.now(),
    orders: state.orders.map((o) => {
      // Live production counters: overall order progress (finished stages plus
      // the running stage's station progress) and units done at the current step.
      const station = state.stations.find((s) => s.currentOrderId === o.id);
      const stageActive = o.stages[o.stageIndex]?.status === 'active';
      const stageFrac = stageActive && station ? station.progress / 100 : 0;
      const overallPct = o.status === 'completed'
        ? 100
        : Math.min(99, Math.round(((o.stageIndex + stageFrac) / Math.max(1, o.stages.length)) * 100));
      return {
        ...o,
        location: orderLocation(o),
        overallPct,
        currentStageUnitsDone: stageActive && station ? Math.min(o.qty, Math.floor((station.progress / 100) * o.qty)) : null,
      };
    }),
    robots: state.robots.map(({ _tempAlerted, ...r }) => r),
    workflows: state.workflows.map((w) => ({ ...w, flat: flattenWorkflow(w.id), totals: workflowTotals(w.id) })),
    stationTypes: state.stationTypes.map((t) => ({ ...t, measuredSecPerUnit: t.composite ? null : measuredSecPerUnit(t.id) })),
    inventory: state.inventory.map((i) => ({ ...i, reservedQty: totalReserved(i.sku) })),
  };
}

// ---- input sanitizers -----------------------------------------------------------
function cleanInputs(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((i) => i && typeof i.sku === 'string' && Number(i.qty) > 0)
    .map((i) => {
      if (!state.inventory.some((item) => item.sku === i.sku)) throw new Error(`unknown material ${i.sku}`);
      return { sku: i.sku, qty: +Number(i.qty).toFixed(2) };
    });
}

// Outputs are informational (they can name things that aren't warehouse SKUs,
// e.g. an intermediate part or the finished product) — no inventory check.
function cleanOutputs(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((i) => i && typeof i.sku === 'string' && i.sku.trim() && Number(i.qty) > 0)
    .map((i) => ({ sku: i.sku.trim(), qty: +Number(i.qty).toFixed(2) }));
}

function cleanSteps(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map((s) => ({
    kind: s.kind,
    refId: s.refId,
    ...(s.kind === 'station' && Array.isArray(s.inputs) && s.inputs.length ? { inputs: cleanInputs(s.inputs) } : {}),
    ...(s.kind === 'station' && Array.isArray(s.outputs) && s.outputs.length ? { outputs: cleanInputs(s.outputs) } : {}),
  }));
}

const handle = (fn) => (req, res) => {
  try {
    const result = fn(req);
    res.status(result?.__created ? 201 : 200).json(result?.__created ? result.body : result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

export const api = Router();

api.get('/health', (_req, res) => res.json({ ok: true, factory: state.factory.name }));

// ---- machine-facing endpoints (gateways, not humans) -------------------------------
// Open by default; set INGEST_TOKEN to require an x-api-key header.

// Telemetry ingestion — what robots / PLC gateways push to.
// Accepts a single message or an array of messages.
api.post('/ingest', gatewayGuard, (req, res) => {
  const messages = Array.isArray(req.body) ? req.body : [req.body];
  const results = [];
  for (const msg of messages) {
    try {
      applyTelemetry(msg);
      results.push({ ok: true });
    } catch (err) {
      results.push({ ok: false, error: err.message });
    }
  }
  const failed = results.filter((r) => !r.ok).length;
  res.status(failed ? 207 : 200).json({ accepted: results.length - failed, failed, results });
});

// Command delivery for gateways that poll instead of using MQTT:
// fetch pending commands for your station(s), execute them, then ACK each id.
api.get('/commands', gatewayGuard, (req, res) => {
  let list = state.commandQueue ?? [];
  if (req.query.status) list = list.filter((c) => c.status === req.query.status);
  if (req.query.target) list = list.filter((c) => c.target === req.query.target || c.target === 'all');
  res.json(list.slice(0, 50));
});
api.post('/commands/:id/ack', gatewayGuard, handle((req) => ackCommand(req.params.id)));

// ---- everything below requires a logged-in user ------------------------------------
api.use(requireUser);

api.get('/state', (_req, res) => res.json(serializeState()));

// ---- operator commands ----------------------------------------------------------
api.post('/stations/:id/command', handle((req) => stationCommand(req.params.id, req.body.action, req.user.username)));
api.post('/stations/:id/release-batch', handle((req) => releaseBatch(req.params.id, req.user.username)));
api.post('/emergency-stop', handle((req) => ({ stations: emergencyStop(req.user.username) })));
api.post('/alerts/:id/ack', handle((req) => acknowledgeAlert(req.params.id, req.user.username)));

api.post('/orders', handle((req) => {
  const { projectId, customer, qty, priority, dueInDays, transferBatch } = req.body;
  if (!projectId || !customer || !qty) throw new Error('projectId, customer and qty are required');
  return { __created: true, body: createOrder({ projectId, customer, qty: Number(qty), priority, dueInDays, transferBatch }) };
}));
api.post('/orders/:id/priority', handle((req) => setOrderPriority(req.params.id, req.body.priority)));
api.post('/orders/:id/cancel', handle((req) => cancelOrder(req.params.id, req.user.username)));
api.post('/orders/:id/reroute', handle((req) => rerouteOrder(req.params.id, req.user.username)));

// ---- station type designer --------------------------------------------------------
function readTypeBody(body, selfId) {
  const name = body.name?.trim();
  if (!name) throw new Error('name is required');
  const composite = !!body.composite;
  const children = composite ? [...new Set(body.children ?? [])] : [];
  if (composite && children.length < 2) throw new Error('a composite station needs at least 2 inner stations');
  validateTypeChildren(selfId, children);
  const dim = (v) => Math.min(4, Math.max(1, Math.round(Number(v) || 1)));
  return {
    name,
    icon: (body.icon ?? '⚙️').slice(0, 8),
    description: (body.description ?? '').slice(0, 200),
    timeSecPerUnit: composite ? 0 : Math.max(0.5, Number(body.timeSecPerUnit) || 3),
    inputs: composite ? [] : cleanInputs(body.inputs),
    // Outputs are real inventory items too (usually half products) — what the
    // station puts back into stock when a batch finishes.
    outputs: composite ? [] : cleanInputs(body.outputs),
    composite,
    children,
    w: dim(body.w),
    h: dim(body.h),
  };
}

api.post('/station-types', requireManager, handle((req) => {
  const id = nextId('tp');
  const type = { id, ...readTypeBody(req.body, id) };
  state.stationTypes.push(type);
  logEvent('designer', 'station-lab', `New station type designed: ${type.icon} ${type.name}`);
  return { __created: true, body: type };
}));

api.put('/station-types/:id', requireManager, handle((req) => {
  const type = state.stationTypes.find((t) => t.id === req.params.id);
  if (!type) throw new Error('unknown station type');
  Object.assign(type, readTypeBody(req.body, type.id));
  logEvent('designer', 'station-lab', `Station type updated: ${type.icon} ${type.name}`);
  return type;
}));

api.delete('/station-types/:id', requireManager, handle((req) => {
  const id = req.params.id;
  const type = state.stationTypes.find((t) => t.id === id);
  if (!type) throw new Error('unknown station type');
  if (state.stations.some((s) => s.typeId === id)) throw new Error('a station of this type is on the factory floor — remove it first');
  if (state.stationTypes.some((t) => t.children?.includes(id))) throw new Error('another composite station contains this type');
  if (state.workflows.some((w) => w.steps.some((s) => s.kind === 'station' && s.refId === id))) throw new Error('a workflow uses this station type');
  state.stationTypes = state.stationTypes.filter((t) => t.id !== id);
  return { ok: true };
}));

// ---- workflow designer -------------------------------------------------------------
function readWorkflowBody(body, selfId) {
  const name = body.name?.trim();
  if (!name) throw new Error('name is required');
  const steps = cleanSteps(body.steps);
  if (!steps.length) throw new Error('a workflow needs at least one step');
  validateWorkflowSteps(selfId, steps);
  return {
    name,
    description: (body.description ?? '').slice(0, 300),
    steps,
    outputs: cleanOutputs(body.outputs),
  };
}

api.post('/workflows', requireManager, handle((req) => {
  const id = nextId('wf');
  const wf = { id, ...readWorkflowBody(req.body, id) };
  state.workflows.push(wf);
  logEvent('designer', 'workflow-studio', `New workflow designed: ${wf.name} (${flattenWorkflow(id).length} steps)`);
  return { __created: true, body: wf };
}));

api.put('/workflows/:id', requireManager, handle((req) => {
  const wf = state.workflows.find((w) => w.id === req.params.id);
  if (!wf) throw new Error('unknown workflow');
  Object.assign(wf, readWorkflowBody(req.body, wf.id));
  logEvent('designer', 'workflow-studio', `Workflow updated: ${wf.name} (in-flight orders keep their old routing)`);
  return wf;
}));

api.delete('/workflows/:id', requireManager, handle((req) => {
  const id = req.params.id;
  if (!state.workflows.some((w) => w.id === id)) throw new Error('unknown workflow');
  const project = state.projects.find((p) => p.workflowId === id);
  if (project) throw new Error(`project "${project.name}" uses this workflow`);
  const parent = state.workflows.find((w) => w.steps.some((s) => s.kind === 'workflow' && s.refId === id));
  if (parent) throw new Error(`workflow "${parent.name}" contains this workflow`);
  state.workflows = state.workflows.filter((w) => w.id !== id);
  return { ok: true };
}));

// ---- factory floor (designer page) ---------------------------------------------------
api.post('/stations', requireManager, handle((req) => {
  const { typeId, name, x, y, rotated } = req.body;
  return { __created: true, body: placeStation({ typeId, name, x: Number(x), y: Number(y), rotated: !!rotated }) };
}));
api.patch('/stations/:id', requireManager, handle((req) => {
  const { name, x, y, servesWorkflowIds } = req.body;
  return updateStation(req.params.id, {
    name,
    x: x !== undefined ? Number(x) : undefined,
    y: y !== undefined ? Number(y) : undefined,
    servesWorkflowIds,
  });
}));
api.delete('/stations/:id', requireManager, handle((req) => removeStation(req.params.id)));

// One-click: replace a type's designed time with the fleet-measured average.
api.post('/station-types/:id/adopt-measured', requireManager, handle((req) => {
  const type = state.stationTypes.find((t) => t.id === req.params.id);
  if (!type) throw new Error('unknown station type');
  if (type.composite) throw new Error('composite stations have no time of their own');
  const measured = measuredSecPerUnit(type.id);
  if (measured == null) throw new Error('no measured data yet — this step has not run on any station');
  const old = type.timeSecPerUnit;
  type.timeSecPerUnit = measured;
  logEvent('designer', 'station-lab', `${type.icon} ${type.name}: designed time updated ${old}s → ${measured}s per unit (measured)`);
  return type;
}));

// Stock adjustments (goods-in, corrections) are plant operations any logged-in
// user may do; changing an item's definition or deleting it is manager work.
api.patch('/inventory/:sku', handle((req) => {
  const item = state.inventory.find((i) => i.sku === req.params.sku);
  if (!item) throw new Error('unknown item');
  if (req.body.qtyDelta !== undefined) {
    const delta = Number(req.body.qtyDelta);
    if (!Number.isFinite(delta) || delta === 0) throw new Error('qtyDelta must be a non-zero number');
    if (delta < 0) {
      const reserved = totalReserved(item.sku);
      if (item.qty + delta < reserved) {
        throw new Error(`cannot remove below reserved stock — ${reserved} ${item.unit} are reserved for running orders (cancel them first)`);
      }
    }
    item.qty = Math.max(0, Math.min(item.capacity, +(item.qty + delta).toFixed(1)));
    logEvent('warehouse', req.user.username, `Stock ${delta > 0 ? 'received' : 'adjusted'}: ${delta > 0 ? '+' : ''}${delta} ${item.unit} ${item.name} → ${item.qty} ${item.unit}`);
    dispatchOrders();
  }
  const definitionTouched = ['name', 'reorderPoint', 'capacity'].some((k) => req.body[k] !== undefined);
  if (definitionTouched) {
    if (req.user.role !== 'manager') throw new Error('manager role required to edit item settings');
    if (req.body.name !== undefined && String(req.body.name).trim()) item.name = String(req.body.name).trim().slice(0, 60);
    if (req.body.reorderPoint !== undefined) item.reorderPoint = Math.max(0, Number(req.body.reorderPoint) || 0);
    if (req.body.capacity !== undefined) item.capacity = Math.max(10, Number(req.body.capacity) || item.capacity);
  }
  return item;
}));

api.delete('/inventory/:sku', requireManager, handle((req) => {
  const sku = req.params.sku;
  const item = state.inventory.find((i) => i.sku === sku);
  if (!item) throw new Error('unknown item');
  const usesIt = (list) => (list ?? []).some((x) => x.sku === sku);
  const type = state.stationTypes.find((t) => usesIt(t.inputs) || usesIt(t.outputs));
  if (type) throw new Error(`station type "${type.name}" uses this item`);
  const wf = state.workflows.find((w) => w.steps.some((s) => usesIt(s.inputs) || usesIt(s.outputs)));
  if (wf) throw new Error(`workflow "${wf.name}" uses this item`);
  const order = state.orders.find((o) => o.status !== 'completed' && o.status !== 'cancelled' &&
    o.stages.some((s) => usesIt(s.inputs) || usesIt(s.outputs)));
  if (order) throw new Error(`open order ${order.code} still uses this item`);
  state.inventory = state.inventory.filter((i) => i.sku !== sku);
  logEvent('warehouse', req.user.username, `Item removed from catalog: ${item.name}`);
  return { ok: true };
}));

// New warehouse item — mainly for defining half products from the designer.
api.post('/inventory', requireManager, handle((req) => {
  const name = req.body.name?.trim();
  if (!name) throw new Error('name is required');
  const sku = (req.body.sku?.trim() || name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (!sku) throw new Error('could not derive a valid sku from that name');
  if (state.inventory.some((i) => i.sku === sku)) throw new Error(`an item with sku "${sku}" already exists`);
  const isHalf = (req.body.category ?? 'Half product') === 'Half product';
  const item = {
    sku,
    name,
    category: req.body.category?.trim() || 'Half product',
    qty: Math.max(0, Number(req.body.qty) || 0),
    unit: (req.body.unit?.trim() || 'pcs').slice(0, 8),
    reorderPoint: isHalf ? 0 : Math.max(0, Number(req.body.reorderPoint) || 0),
    capacity: Math.max(10, Number(req.body.capacity) || 1000),
    consumedToday: 0,
  };
  state.inventory.push(item);
  logEvent('designer', 'warehouse', `New ${item.category.toLowerCase()} defined: ${item.name}`);
  return { __created: true, body: item };
}));

// ---- factory floor size ----------------------------------------------------------------
api.patch('/factory', requireManager, handle((req) => {
  const { gridW, gridH, name } = req.body;
  if (name !== undefined && String(name).trim()) state.factory.name = String(name).trim().slice(0, 60);
  if (gridW !== undefined || gridH !== undefined) {
    const w = Math.round(Number(gridW ?? state.factory.grid.w));
    const h = Math.round(Number(gridH ?? state.factory.grid.h));
    if (!Number.isFinite(w) || !Number.isFinite(h) || w < 8 || h < 6 || w > 60 || h > 40) {
      throw new Error('floor size must be between 8×6 and 60×40 cells');
    }
    const blocker = state.stations.find((s) => s.x + (s.w ?? 1) > w || s.y + (s.h ?? 1) > h);
    if (blocker) throw new Error(`cannot shrink: "${blocker.name}" would fall off the floor — move or dismantle it first`);
    state.factory.grid = { w, h };
    logEvent('designer', 'factory', `Factory floor resized to ${w}×${h} cells`);
  }
  return state.factory;
}));

// ---- projects (product lines) ---------------------------------------------------------
api.post('/projects', requireManager, handle((req) => {
  const { name, product, workflowId } = req.body;
  if (!name?.trim() || !product?.trim()) throw new Error('name and product are required');
  if (!state.workflows.some((w) => w.id === workflowId)) throw new Error('pick a workflow for this product line');
  const project = { id: nextId('prj'), name: name.trim(), product: product.trim(), status: 'active', workflowId };
  state.projects.push(project);
  logEvent('designer', 'projects', `New product line: ${project.name} — ${project.product}`);
  return { __created: true, body: project };
}));

api.patch('/projects/:id', requireManager, handle((req) => {
  const project = state.projects.find((p) => p.id === req.params.id);
  if (!project) throw new Error('unknown project');
  if (req.body.workflowId !== undefined) {
    if (!state.workflows.some((w) => w.id === req.body.workflowId)) throw new Error('unknown workflow');
    project.workflowId = req.body.workflowId;
    logEvent('designer', 'projects', `${project.name} now runs workflow "${state.workflows.find((w) => w.id === project.workflowId).name}" (new orders only)`);
    dispatchOrders();
  }
  if (req.body.status !== undefined) project.status = req.body.status;
  return project;
}));
