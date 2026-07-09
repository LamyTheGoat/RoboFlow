import { Router } from 'express';
import { state, nextId, logEvent } from './store.js';
import { applyTelemetry } from './ingest.js';
import { stationCommand, emergencyStop, acknowledgeAlert, setOrderPriority } from './commands.js';
import {
  createOrder, orderLocation, dispatchOrders,
  placeStation, updateStation, removeStation,
} from './workflow.js';
import {
  flattenWorkflow, workflowTotals,
  validateWorkflowSteps, validateTypeChildren,
} from './catalog.js';

// Snapshot sent to clients (REST and WebSocket) — raw state plus the
// computed fields the UI needs, minus sim-internal ones.
export function serializeState() {
  return {
    ...state,
    now: Date.now(),
    orders: state.orders.map((o) => ({ ...o, location: orderLocation(o) })),
    robots: state.robots.map(({ _tempAlerted, ...r }) => r),
    workflows: state.workflows.map((w) => ({ ...w, flat: flattenWorkflow(w.id), totals: workflowTotals(w.id) })),
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
api.get('/state', (_req, res) => res.json(serializeState()));

// Telemetry ingestion — what robots / PLC gateways push to.
// Accepts a single message or an array of messages.
api.post('/ingest', (req, res) => {
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

// ---- operator commands ----------------------------------------------------------
api.post('/stations/:id/command', handle((req) => stationCommand(req.params.id, req.body.action)));
api.post('/emergency-stop', handle(() => ({ stations: emergencyStop() })));
api.post('/alerts/:id/ack', handle((req) => acknowledgeAlert(req.params.id)));

api.post('/orders', handle((req) => {
  const { projectId, customer, qty, priority, dueInDays } = req.body;
  if (!projectId || !customer || !qty) throw new Error('projectId, customer and qty are required');
  return { __created: true, body: createOrder({ projectId, customer, qty: Number(qty), priority, dueInDays }) };
}));
api.post('/orders/:id/priority', handle((req) => setOrderPriority(req.params.id, req.body.priority)));

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
    outputs: cleanOutputs(body.outputs),
    composite,
    children,
    w: dim(body.w),
    h: dim(body.h),
  };
}

api.post('/station-types', handle((req) => {
  const id = nextId('tp');
  const type = { id, ...readTypeBody(req.body, id) };
  state.stationTypes.push(type);
  logEvent('designer', 'station-lab', `New station type designed: ${type.icon} ${type.name}`);
  return { __created: true, body: type };
}));

api.put('/station-types/:id', handle((req) => {
  const type = state.stationTypes.find((t) => t.id === req.params.id);
  if (!type) throw new Error('unknown station type');
  Object.assign(type, readTypeBody(req.body, type.id));
  logEvent('designer', 'station-lab', `Station type updated: ${type.icon} ${type.name}`);
  return type;
}));

api.delete('/station-types/:id', handle((req) => {
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

api.post('/workflows', handle((req) => {
  const id = nextId('wf');
  const wf = { id, ...readWorkflowBody(req.body, id) };
  state.workflows.push(wf);
  logEvent('designer', 'workflow-studio', `New workflow designed: ${wf.name} (${flattenWorkflow(id).length} steps)`);
  return { __created: true, body: wf };
}));

api.put('/workflows/:id', handle((req) => {
  const wf = state.workflows.find((w) => w.id === req.params.id);
  if (!wf) throw new Error('unknown workflow');
  Object.assign(wf, readWorkflowBody(req.body, wf.id));
  logEvent('designer', 'workflow-studio', `Workflow updated: ${wf.name} (in-flight orders keep their old routing)`);
  return wf;
}));

api.delete('/workflows/:id', handle((req) => {
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
api.post('/stations', handle((req) => {
  const { typeId, name, x, y } = req.body;
  return { __created: true, body: placeStation({ typeId, name, x: Number(x), y: Number(y) }) };
}));
api.patch('/stations/:id', handle((req) => {
  const { name, x, y } = req.body;
  return updateStation(req.params.id, {
    name,
    x: x !== undefined ? Number(x) : undefined,
    y: y !== undefined ? Number(y) : undefined,
  });
}));
api.delete('/stations/:id', handle((req) => removeStation(req.params.id)));

// ---- projects (product lines) ---------------------------------------------------------
api.post('/projects', handle((req) => {
  const { name, product, workflowId } = req.body;
  if (!name?.trim() || !product?.trim()) throw new Error('name and product are required');
  if (!state.workflows.some((w) => w.id === workflowId)) throw new Error('pick a workflow for this product line');
  const project = { id: nextId('prj'), name: name.trim(), product: product.trim(), status: 'active', workflowId };
  state.projects.push(project);
  logEvent('designer', 'projects', `New product line: ${project.name} — ${project.product}`);
  return { __created: true, body: project };
}));

api.patch('/projects/:id', handle((req) => {
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
