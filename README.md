# RoboFlow

An online control room for automated industrial production. It gives a factory
manager one live screen for everything on the floor: projects, workstations and
robots, workflow status, order whereabouts, warehouse stock, alerts — plus
basic operator commands (start / pause / stop a station, emergency stop,
acknowledge alerts, create orders, change priorities).

It is also a factory *design* tool:

- **Design studio → Station types** — design your own stations: icon, time per
  unit, materials consumed (inputs) and produced (outputs), and a **footprint**
  (width × depth in floor cells, up to 4×4) so the layout view reflects real
  floor space. Stations can be **composite** (recursive): one physical cell
  that contains other stations — including other composites — and can do all
  of their jobs.
- **Design studio → Workflows** — chain stations into workflows, reorder steps,
  override the materials any step uses. A workflow step can be a station *or a
  whole other workflow* (recursive nesting, cycle-guarded). Each product line
  (project) picks the workflow its orders run through; edits apply to new
  orders while orders already on the floor keep their routing.
- **Factory** — a Factorio-style top-down floor. Place stations from the
  palette onto the grid (each occupies its designed footprint; overlaps and
  out-of-bounds installs are refused) and they instantly become real, live
  stations that the plant dispatches work to. Select a workflow to see its
  animated conveyor route from Warehouse to Dispatch, watch order pucks travel
  between stations, and move / rename / dismantle stations in place.

![Control room](docs/screenshot-overview.png)

## How it works

```
robots / PLC gateways ──POST /api/ingest──▶  server  ──WebSocket /ws──▶  control room UI
                                             │
                              workflow engine + in-memory state
                              (orders, stations, stock, alerts)
```

- **`server/`** — Node/Express. Exposes the telemetry ingestion API, the
  operator command API, and a WebSocket feed that streams the full plant state
  to every connected browser once a second (events and alerts immediately).
  State is kept in memory and snapshotted to `server/data/state.json`; swap in
  a database for a real deployment.
- **`client/`** — React + Vite. Dark control-room UI with six views:
  Overview, Stations, Orders, Projects, Warehouse, Alerts.
- **Built-in simulator** — stands in for the real plant. It pushes the *same*
  messages a robot gateway would send to `/api/ingest`, so the entire pipeline
  is exercised exactly as in production. Disable it with `SIMULATOR=off` when
  connecting real equipment.

## Running it

```bash
npm install

# development (server on :4000, client with hot reload on :5173)
npm run dev

# production (single server on :4000 serving the built UI)
npm run build
npm start
```

Then open http://localhost:5173 (dev) or http://localhost:4000 (production).

Environment variables: `PORT` (default 4000), `SIMULATOR=off` to disable the
floor simulator, `FRESH_STATE=1` to ignore the saved snapshot and reseed.

## Connecting real robots / stations

Point your robot controllers or PLC gateway at `POST /api/ingest` with JSON
(single message or an array):

```jsonc
{ "kind": "robot.telemetry",  "robotId": "rb_03", "status": "working", "temperatureC": 61.2, "toolWearPct": 44, "cyclesDelta": 2 }
{ "kind": "station.status",   "stationId": "st_weld1", "status": "fault", "reason": "Torque limit exceeded on axis 3" }
{ "kind": "station.progress", "stationId": "st_weld1", "progress": 62 }
{ "kind": "stage.completed",  "stationId": "st_weld1" }
{ "kind": "alert",            "source": "line-plc", "severity": "warning", "message": "Air pressure low" }
```

The workflow engine reacts server-side: `stage.completed` advances the active
order to its next stage, dispatches queued orders to idle stations, and books
material consumption against the warehouse.

## Command API (what the UI buttons call)

| Endpoint | Action |
|---|---|
| `POST /api/stations/:id/command` | `{"action": "start" \| "pause" \| "stop" \| "reset_fault"}` |
| `POST /api/emergency-stop` | halt every station |
| `POST /api/alerts/:id/ack` | acknowledge an alert |
| `POST /api/orders` | `{projectId, customer, qty, priority?, dueInDays?}` |
| `POST /api/orders/:id/priority` | `{"priority": "low" \| "normal" \| "high"}` |
| `GET /api/state` | full plant snapshot (same payload as the WebSocket feed) |

## Designer API (what the Design studio and Factory pages call)

| Endpoint | Action |
|---|---|
| `POST/PUT/DELETE /api/station-types[/:id]` | design station types; `{name, icon, timeSecPerUnit, inputs, outputs, composite, children}` |
| `POST/PUT/DELETE /api/workflows[/:id]` | design workflows; steps are `{kind: "station" \| "workflow", refId, inputs?}` |
| `POST /api/stations` | install a station on the floor: `{typeId, x, y, name?}` |
| `PATCH /api/stations/:id` | move / rename: `{x?, y?, name?}` |
| `DELETE /api/stations/:id` | dismantle (refused while it works on an order) |
| `POST /api/projects` | new product line: `{name, product, workflowId}` |
| `PATCH /api/projects/:id` | reassign workflow: `{workflowId}` (new orders only) |

Recursion is cycle-guarded server-side: a workflow can never contain itself
(directly or through nesting) and a composite station can never contain itself.
Orders snapshot their flattened workflow at creation, so editing definitions
never disturbs work already in progress.
