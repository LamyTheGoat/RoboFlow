// Station types and workflows are user-designed and can nest recursively:
// a composite station type contains other station types, and a workflow step
// can reference another workflow. This module resolves those trees into flat,
// executable sequences (with path-based cycle guards) and validates edits so
// no definition can ever contain itself.
import { state } from './store.js';

export const getType = (id) => state.stationTypes.find((t) => t.id === id);
export const getWorkflow = (id) => state.workflows.find((w) => w.id === id);

// A composite type expands to its leaf children; a leaf type is itself.
export function leafTypeIds(typeId, path = new Set()) {
  const type = getType(typeId);
  if (!type || path.has(typeId)) return [];
  if (!type.composite) return [typeId];
  path.add(typeId);
  const leaves = (type.children ?? []).flatMap((c) => leafTypeIds(c, path));
  path.delete(typeId);
  return leaves;
}

// Can a physical station of type `stationTypeId` perform a step that needs
// `leafTypeId`? Composite stations can perform any of their leaf capabilities.
export function typeServes(stationTypeId, leafTypeId) {
  return leafTypeIds(stationTypeId).includes(leafTypeId);
}

function leafStep(type, overrideInputs) {
  return {
    name: type.name,
    typeId: type.id,
    icon: type.icon,
    inputs: overrideInputs?.length ? overrideInputs : (type.inputs ?? []),
    timeSecPerUnit: type.timeSecPerUnit,
  };
}

// Expand a workflow into the flat list of leaf station steps an order will
// actually walk through. Nested workflows and composite types are expanded;
// the path set stops runaway recursion (repeats in sequence are allowed).
export function flattenWorkflow(workflowId, path = new Set()) {
  const wf = getWorkflow(workflowId);
  if (!wf || path.has(workflowId)) return [];
  path.add(workflowId);
  const steps = [];
  for (const step of wf.steps ?? []) {
    if (step.kind === 'workflow') {
      steps.push(...flattenWorkflow(step.refId, path));
    } else {
      const type = getType(step.refId);
      if (!type) continue;
      if (type.composite) {
        for (const leafId of leafTypeIds(type.id)) steps.push(leafStep(getType(leafId)));
      } else {
        steps.push(leafStep(type, step.inputs));
      }
    }
  }
  path.delete(workflowId);
  return steps;
}

// Fleet-wide measured pace for a leaf type: sample-weighted average of the
// per-station EMAs collected by the workflow engine. null until any station
// has actually run this step type.
export function measuredSecPerUnit(typeId) {
  let weighted = 0;
  let n = 0;
  for (const s of state.stations) {
    const rec = s.actualByType?.[typeId];
    if (rec?.ema != null && rec.n > 0) {
      weighted += rec.ema * rec.n;
      n += rec.n;
    }
  }
  return n ? +(weighted / n).toFixed(2) : null;
}

// Aggregate materials + processing time per unit for a workflow. Measured time
// falls back to the designed time for steps that haven't run yet.
export function workflowTotals(workflowId) {
  const flat = flattenWorkflow(workflowId);
  const inputs = new Map();
  let timeSecPerUnit = 0;
  let measuredTime = 0;
  let anyMeasured = false;
  for (const step of flat) {
    timeSecPerUnit += step.timeSecPerUnit ?? 0;
    const m = measuredSecPerUnit(step.typeId);
    measuredTime += m ?? step.timeSecPerUnit ?? 0;
    if (m != null) anyMeasured = true;
    for (const inp of step.inputs) inputs.set(inp.sku, +((inputs.get(inp.sku) ?? 0) + inp.qty).toFixed(2));
  }
  return {
    inputsPerUnit: [...inputs].map(([sku, qty]) => ({ sku, qty })),
    timeSecPerUnit: +timeSecPerUnit.toFixed(1),
    measuredSecPerUnit: anyMeasured ? +measuredTime.toFixed(1) : null,
  };
}

// ---- cycle validation for edits ------------------------------------------------
export function workflowReaches(fromId, targetId, path = new Set()) {
  if (fromId === targetId) return true;
  if (path.has(fromId)) return false;
  path.add(fromId);
  const wf = getWorkflow(fromId);
  return (wf?.steps ?? []).some((s) => s.kind === 'workflow' && workflowReaches(s.refId, targetId, path));
}

export function typeReaches(fromId, targetId, path = new Set()) {
  if (fromId === targetId) return true;
  if (path.has(fromId)) return false;
  path.add(fromId);
  const type = getType(fromId);
  return (type?.children ?? []).some((c) => typeReaches(c, targetId, path));
}

export function validateWorkflowSteps(selfId, steps) {
  if (!Array.isArray(steps)) throw new Error('steps must be an array');
  for (const step of steps) {
    if (step.kind === 'station') {
      if (!getType(step.refId)) throw new Error(`unknown station type ${step.refId}`);
    } else if (step.kind === 'workflow') {
      if (!getWorkflow(step.refId)) throw new Error(`unknown workflow ${step.refId}`);
      if (step.refId === selfId || workflowReaches(step.refId, selfId)) {
        throw new Error('that would create a workflow loop (a workflow cannot contain itself)');
      }
    } else {
      throw new Error(`step kind must be "station" or "workflow"`);
    }
  }
}

export function validateTypeChildren(selfId, children) {
  for (const childId of children ?? []) {
    if (!getType(childId)) throw new Error(`unknown station type ${childId}`);
    if (childId === selfId || typeReaches(childId, selfId)) {
      throw new Error('that would create a station loop (a station cannot contain itself)');
    }
  }
}

// Build the stage snapshot an order carries for its whole life. Edits to
// workflows/types later never disturb orders already on the floor.
export function buildOrderStages(workflowId) {
  return flattenWorkflow(workflowId).map((step) => ({
    ...step,
    status: 'pending',
    startedAt: null,
    finishedAt: null,
    stationId: null,
  }));
}
