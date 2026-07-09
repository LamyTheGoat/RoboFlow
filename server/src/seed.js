// Initial factory layout: a mid-size plant with user-editable station types,
// workflows (including one nested workflow as a recursion example), physical
// stations placed on the factory grid, and three product lines.

export const STATE_VERSION = 3;
export const GRID_W = 20;
export const GRID_H = 12;

export function buildSeedState() {
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;

  const stationTypes = [
    type('tp_cut', 'Cutter', '✂️', 3, 'Cuts raw sheets and profiles to size', [inp('steel-sheet', 2)], 2, 1),
    type('tp_weld', 'Welder', '🔥', 4, 'Joins cut parts into frames', [inp('welding-wire', 0.4)], 1, 1),
    type('tp_asm', 'Assembler', '🔧', 5, 'Mounts components onto frames', [inp('fastener-m8', 10)], 2, 2),
    type('tp_paint', 'Paint Booth', '🎨', 3, 'Applies protective coating', [inp('paint-ral7016', 0.4)], 2, 1),
    type('tp_qa', 'Inspector', '🔍', 2, 'Vision-checks every unit', [], 1, 1),
    type('tp_pack', 'Packager', '📦', 1.5, 'Boxes finished goods for dispatch', [inp('carton-m', 1)], 2, 1),
    {
      ...type('tp_finishcell', 'Finishing Cell', '🏭', 0, 'All-in-one cell: paints, inspects and packs', [], 2, 2),
      composite: true,
      children: ['tp_paint', 'tp_qa', 'tp_pack'],
    },
  ];

  const workflows = [
    {
      id: 'wf_finish',
      name: 'Finishing & Dispatch',
      description: 'Shared tail of most lines: coat, inspect, box. Reused inside other workflows.',
      steps: [
        step('station', 'tp_paint'),
        step('station', 'tp_qa'),
        step('station', 'tp_pack'),
      ],
      outputs: [{ sku: 'finished-goods', qty: 1 }],
    },
    {
      id: 'wf_atlas',
      name: 'Arm Base Line',
      description: 'Full build of the AX-100 robotic arm base.',
      steps: [
        step('station', 'tp_cut', [inp('steel-sheet', 2)]),
        step('station', 'tp_weld', [inp('welding-wire', 0.4)]),
        step('station', 'tp_asm', [inp('fastener-m8', 12), inp('servo-motor', 1), inp('control-pcb', 1)]),
        step('station', 'tp_qa'),
        step('station', 'tp_pack', [inp('carton-l', 1)]),
      ],
      outputs: [{ sku: 'finished-goods', qty: 1 }],
    },
    {
      id: 'wf_borealis',
      name: 'Conveyor Drive Line',
      description: 'CD-40 drive units. Ends with the shared Finishing & Dispatch workflow.',
      steps: [
        step('station', 'tp_cut', [inp('alu-profile', 3)]),
        step('station', 'tp_asm', [inp('bearing-6204', 4), inp('servo-motor', 1), inp('fastener-m8', 8)]),
        step('workflow', 'wf_finish'),
      ],
      outputs: [{ sku: 'finished-goods', qty: 1 }],
    },
    {
      id: 'wf_cascade',
      name: 'Manifold Line',
      description: 'HM-8 hydraulic manifolds. Ends with the shared Finishing & Dispatch workflow.',
      steps: [
        step('station', 'tp_cut', [inp('steel-sheet', 1)]),
        step('station', 'tp_weld', [inp('welding-wire', 0.2), inp('hydraulic-valve', 6)]),
        step('workflow', 'wf_finish'),
      ],
      outputs: [{ sku: 'finished-goods', qty: 1 }],
    },
  ];

  const projects = [
    { id: 'prj_atlas', name: 'Atlas', product: 'AX-100 Robotic Arm Base', status: 'active', workflowId: 'wf_atlas' },
    { id: 'prj_borealis', name: 'Borealis', product: 'CD-40 Conveyor Drive Unit', status: 'active', workflowId: 'wf_borealis' },
    { id: 'prj_cascade', name: 'Cascade', product: 'HM-8 Hydraulic Manifold', status: 'active', workflowId: 'wf_cascade' },
  ];

  const stations = [
    station('st_cut1', 'Laser Cutting Cell 1', 'tp_cut', 2, 2),
    station('st_cut2', 'CNC Milling Cell 2', 'tp_cut', 2, 6),
    station('st_weld1', 'Welding Cell A', 'tp_weld', 5, 4),
    station('st_asm1', 'Assembly Line 1', 'tp_asm', 8, 2),
    station('st_asm2', 'Assembly Line 2', 'tp_asm', 8, 6),
    station('st_paint1', 'Paint Booth', 'tp_paint', 11, 4),
    station('st_qa1', 'Inspection Cell', 'tp_qa', 14, 4),
    station('st_pack1', 'Packaging Line', 'tp_pack', 17, 4),
  ];
  // Stations carry a snapshot of their type's footprint at install time.
  for (const s of stations) {
    const t = stationTypes.find((x) => x.id === s.typeId);
    s.w = t.w;
    s.h = t.h;
  }

  const robots = [
    robot('rb_01', 'KR-210 #01', 'KUKA KR 210', 'st_cut1'),
    robot('rb_02', 'M-20iD #02', 'FANUC M-20iD', 'st_cut2'),
    robot('rb_03', 'IRB-6700 #03', 'ABB IRB 6700', 'st_weld1'),
    robot('rb_04', 'IRB-6700 #04', 'ABB IRB 6700', 'st_weld1'),
    robot('rb_05', 'UR10e #05', 'Universal UR10e', 'st_asm1'),
    robot('rb_06', 'UR10e #06', 'Universal UR10e', 'st_asm1'),
    robot('rb_07', 'UR10e #07', 'Universal UR10e', 'st_asm2'),
    robot('rb_08', 'P-250iB #08', 'FANUC P-250iB', 'st_paint1'),
    robot('rb_09', 'VS-087 #09', 'DENSO VS-087 (vision)', 'st_qa1'),
    robot('rb_10', 'D3-1300 #10', 'Delta D3-1300', 'st_pack1'),
  ];

  const inventory = [
    item('steel-sheet', 'Steel Sheet 3mm', 'Raw material', 240, 'pcs', 80, 600),
    item('alu-profile', 'Aluminium Profile 40x40', 'Raw material', 310, 'm', 120, 800),
    item('welding-wire', 'Welding Wire ER70S', 'Consumable', 55, 'kg', 20, 120),
    item('paint-ral7016', 'Paint RAL 7016', 'Consumable', 38, 'L', 15, 100),
    item('fastener-m8', 'Fasteners M8', 'Component', 4200, 'pcs', 1500, 10000),
    item('servo-motor', 'Servo Motor 750W', 'Component', 64, 'pcs', 25, 200),
    item('bearing-6204', 'Bearing 6204-2RS', 'Component', 380, 'pcs', 150, 1000),
    item('control-pcb', 'Control PCB v4', 'Component', 52, 'pcs', 30, 150),
    item('hydraulic-valve', 'Hydraulic Valve DN10', 'Component', 96, 'pcs', 60, 300),
    item('carton-s', 'Carton Box S', 'Packaging', 210, 'pcs', 100, 500),
    item('carton-m', 'Carton Box M', 'Packaging', 180, 'pcs', 100, 500),
    item('carton-l', 'Carton Box L', 'Packaging', 140, 'pcs', 80, 400),
  ];

  // Local flatten for seeding orders (catalog.js reads live state, which
  // doesn't exist yet while we build it).
  const flatten = (wfId, path = new Set()) => {
    const wf = workflows.find((w) => w.id === wfId);
    if (!wf || path.has(wfId)) return [];
    path.add(wfId);
    const out = (wf.steps ?? []).flatMap((s) => {
      if (s.kind === 'workflow') return flatten(s.refId, path);
      const t = stationTypes.find((x) => x.id === s.refId);
      return [{ name: t.name, typeId: t.id, icon: t.icon, inputs: s.inputs?.length ? s.inputs : t.inputs, timeSecPerUnit: t.timeSecPerUnit }];
    });
    path.delete(wfId);
    return out;
  };
  const stagesFor = (projectId) =>
    flatten(projects.find((p) => p.id === projectId).workflowId).map((s) => ({
      ...s, status: 'pending', startedAt: null, finishedAt: null, stationId: null,
    }));

  const order = (id, code, projectId, customer, qty, priority, created, due) => ({
    id, code, projectId, customer, qty, priority,
    status: 'queued', stageIndex: 0, stages: stagesFor(projectId),
    materialsConsumed: false, createdAt: created, dueDate: due, completedAt: null,
  });

  const orders = [
    order('ord_1001', 'ORD-1001', 'prj_atlas', 'Nordwerk GmbH', 12, 'high', now - 2 * day, now + 3 * day),
    order('ord_1002', 'ORD-1002', 'prj_borealis', 'Meridian Logistics', 8, 'normal', now - 2 * day, now + 5 * day),
    order('ord_1003', 'ORD-1003', 'prj_cascade', 'HydroParts AS', 20, 'normal', now - day, now + 6 * day),
    order('ord_1004', 'ORD-1004', 'prj_atlas', 'Vektor Automation', 6, 'low', now - day, now + 9 * day),
    order('ord_1005', 'ORD-1005', 'prj_borealis', 'Meridian Logistics', 15, 'high', now - day, now + 4 * day),
    order('ord_1006', 'ORD-1006', 'prj_cascade', 'BalticFluid OÜ', 10, 'normal', now, now + 8 * day),
  ];

  return {
    version: STATE_VERSION,
    factory: { name: 'RoboFlow Plant 1', location: 'Hall B, Line 1-8', simulator: true, grid: { w: GRID_W, h: GRID_H } },
    stationTypes,
    workflows,
    projects,
    stations,
    robots,
    orders,
    inventory,
    alerts: [],
    events: [
      { id: 'evt_seed', ts: now, type: 'system', source: 'control-room', message: 'Control room online — state initialized' },
    ],
    metrics: { unitsToday: 0, throughputHistory: [] },
  };
}

function type(id, name, icon, timeSecPerUnit, description, inputs, w = 1, h = 1) {
  return { id, name, icon, timeSecPerUnit, description, inputs, outputs: [], composite: false, children: [], w, h };
}
const inp = (sku, qty) => ({ sku, qty });
const step = (kind, refId, inputs) => ({ kind, refId, ...(inputs ? { inputs } : {}) });

function station(id, name, typeId, x, y) {
  return {
    id, name, typeId, x, y,
    status: 'idle', // idle | running | paused | stopped | fault | maintenance
    currentOrderId: null,
    progress: 0,
    utilization: 0,
    unitsToday: 0,
    lastSeen: Date.now(),
  };
}

function robot(id, name, model, stationId) {
  return {
    id, name, model, stationId,
    status: 'idle',
    temperatureC: 34 + Math.round(Math.random() * 6),
    toolWearPct: Math.round(Math.random() * 35),
    cyclesTotal: 10000 + Math.round(Math.random() * 90000),
    lastSeen: Date.now(),
  };
}

function item(sku, name, category, qty, unit, reorderPoint, capacity) {
  return { sku, name, category, qty, unit, reorderPoint, capacity, consumedToday: 0 };
}
