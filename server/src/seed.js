// Initial factory layout. This is demo data: a mid-size plant with three
// product lines flowing through eight robotic workstations.

const STAGES = {
  cutting: 'Cutting',
  welding: 'Welding',
  assembly: 'Assembly',
  painting: 'Painting',
  qa: 'Quality Control',
  packaging: 'Packaging',
};

export function buildSeedState() {
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;

  const projects = [
    {
      id: 'prj_atlas',
      name: 'Atlas',
      product: 'AX-100 Robotic Arm Base',
      status: 'active',
      workflow: ['cutting', 'welding', 'assembly', 'qa', 'packaging'],
      bom: { 'steel-sheet': 2, 'welding-wire': 0.4, 'fastener-m8': 12, 'servo-motor': 1, 'control-pcb': 1, 'carton-l': 1 },
    },
    {
      id: 'prj_borealis',
      name: 'Borealis',
      product: 'CD-40 Conveyor Drive Unit',
      status: 'active',
      workflow: ['cutting', 'assembly', 'painting', 'qa', 'packaging'],
      bom: { 'alu-profile': 3, 'bearing-6204': 4, 'servo-motor': 1, 'fastener-m8': 8, 'paint-ral7016': 0.5, 'carton-m': 1 },
    },
    {
      id: 'prj_cascade',
      name: 'Cascade',
      product: 'HM-8 Hydraulic Manifold',
      status: 'active',
      workflow: ['cutting', 'welding', 'painting', 'qa', 'packaging'],
      bom: { 'steel-sheet': 1, 'welding-wire': 0.2, 'hydraulic-valve': 6, 'paint-ral7016': 0.3, 'carton-s': 1 },
    },
  ];

  const stations = [
    station('st_cut1', 'Laser Cutting Cell 1', 'cutting', 9),
    station('st_cut2', 'CNC Milling Cell 2', 'cutting', 7),
    station('st_weld1', 'Welding Cell A', 'welding', 6),
    station('st_asm1', 'Assembly Line 1', 'assembly', 5),
    station('st_asm2', 'Assembly Line 2', 'assembly', 5),
    station('st_paint1', 'Paint Booth', 'painting', 8),
    station('st_qa1', 'Inspection Cell', 'qa', 10),
    station('st_pack1', 'Packaging Line', 'packaging', 12),
  ];

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

  const orders = [
    order('ord_1001', 'ORD-1001', 'prj_atlas', 'Nordwerk GmbH', 12, 'high', now - 2 * day, now + 3 * day, projects),
    order('ord_1002', 'ORD-1002', 'prj_borealis', 'Meridian Logistics', 8, 'normal', now - 2 * day, now + 5 * day, projects),
    order('ord_1003', 'ORD-1003', 'prj_cascade', 'HydroParts AS', 20, 'normal', now - day, now + 6 * day, projects),
    order('ord_1004', 'ORD-1004', 'prj_atlas', 'Vektor Automation', 6, 'low', now - day, now + 9 * day, projects),
    order('ord_1005', 'ORD-1005', 'prj_borealis', 'Meridian Logistics', 15, 'high', now - day, now + 4 * day, projects),
    order('ord_1006', 'ORD-1006', 'prj_cascade', 'BalticFluid OÜ', 10, 'normal', now, now + 8 * day, projects),
  ];

  return {
    factory: { name: 'RoboFlow Plant 1', location: 'Hall B, Line 1-8', simulator: true },
    stageNames: STAGES,
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

function station(id, name, stage, speed) {
  return {
    id,
    name,
    stage,
    status: 'idle', // idle | running | paused | stopped | fault | maintenance
    currentOrderId: null,
    progress: 0, // % of current stage batch
    speed, // sim: average % progress per tick
    utilization: 0,
    unitsToday: 0,
    lastSeen: Date.now(),
  };
}

function robot(id, name, model, stationId) {
  return {
    id,
    name,
    model,
    stationId,
    status: 'idle', // idle | working | paused | fault | offline
    temperatureC: 34 + Math.round(Math.random() * 6),
    toolWearPct: Math.round(Math.random() * 35),
    cyclesTotal: 10000 + Math.round(Math.random() * 90000),
    lastSeen: Date.now(),
  };
}

function item(sku, name, category, qty, unit, reorderPoint, capacity) {
  return { sku, name, category, qty, unit, reorderPoint, capacity, consumedToday: 0 };
}

function order(id, code, projectId, customer, qty, priority, createdAt, dueDate, projects) {
  const project = projects.find((p) => p.id === projectId);
  return {
    id,
    code,
    projectId,
    customer,
    qty,
    priority, // low | normal | high
    status: 'queued', // queued | in_progress | on_hold | completed
    stageIndex: 0,
    stages: project.workflow.map((stage) => ({ stage, status: 'pending', startedAt: null, finishedAt: null })),
    materialsConsumed: false,
    createdAt,
    dueDate,
    completedAt: null,
  };
}
