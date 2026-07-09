import { Router } from 'express';
import { state } from './store.js';
import { applyTelemetry } from './ingest.js';
import { stationCommand, emergencyStop, acknowledgeAlert, setOrderPriority } from './commands.js';
import { createOrder, orderLocation, currentStageOf } from './workflow.js';

// Snapshot sent to clients (REST and WebSocket) — raw state plus the
// computed fields the UI needs, minus sim-internal ones.
export function serializeState() {
  return {
    ...state,
    now: Date.now(),
    orders: state.orders.map((o) => ({
      ...o,
      currentStage: currentStageOf(o),
      location: orderLocation(o),
    })),
    robots: state.robots.map(({ _tempAlerted, ...r }) => r),
  };
}

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

// Operator commands.
api.post('/stations/:id/command', (req, res) => {
  try {
    res.json(stationCommand(req.params.id, req.body.action));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

api.post('/emergency-stop', (_req, res) => {
  res.json({ stations: emergencyStop() });
});

api.post('/alerts/:id/ack', (req, res) => {
  try {
    res.json(acknowledgeAlert(req.params.id));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

api.post('/orders', (req, res) => {
  try {
    const { projectId, customer, qty, priority, dueInDays } = req.body;
    if (!projectId || !customer || !qty) throw new Error('projectId, customer and qty are required');
    res.status(201).json(createOrder({ projectId, customer, qty: Number(qty), priority, dueInDays }));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

api.post('/orders/:id/priority', (req, res) => {
  try {
    res.json(setOrderPriority(req.params.id, req.body.priority));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
