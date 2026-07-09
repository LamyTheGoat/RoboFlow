# RoboFlow

An online control room for automated industrial production. It gives a factory
manager one live screen for everything on the floor: projects, workstations and
robots, workflow status, order whereabouts, warehouse stock, alerts — plus
basic operator commands (start / pause / stop a station, emergency stop,
acknowledge alerts, create orders, change priorities).

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
