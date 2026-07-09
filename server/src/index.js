import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { state, subscribe, persist } from './store.js';
import { api, serializeState } from './routes.js';
import { startSimulator } from './simulator.js';
import { attachUser, authRouter, userFromRequest, AUTH_ENABLED } from './auth.js';
import { startMqttBridge } from './mqtt.js';

const PORT = Number(process.env.PORT ?? 4000);
const SIMULATOR = process.env.SIMULATOR !== 'off';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(attachUser);
app.use('/api/auth', authRouter);
app.use('/api', api);

// In production the server also serves the built client.
const clientDist = path.join(__dirname, '..', '..', 'client', 'dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get(/^(?!\/api|\/ws).*/, (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
}

const server = http.createServer(app);

// ---- live feed --------------------------------------------------------------
const wss = new WebSocketServer({ server, path: '/ws' });

function broadcast(message) {
  const data = JSON.stringify(message);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(data);
  }
}

wss.on('connection', (ws, req) => {
  if (!userFromRequest(req)) {
    ws.close(4401, 'login required');
    return;
  }
  ws.send(JSON.stringify({ type: 'state', state: serializeState() }));
});

// Events and alerts go out immediately; the full state goes out once a second
// so every client stays in sync without a diff protocol.
subscribe((message) => broadcast(message));
setInterval(() => {
  if (wss.clients.size > 0) broadcast({ type: 'state', state: serializeState() });
}, 1000);

setInterval(persist, 15000);
process.on('SIGINT', () => {
  persist();
  process.exit(0);
});
process.on('SIGTERM', () => {
  persist();
  process.exit(0);
});

server.listen(PORT, () => {
  console.log(`RoboFlow control room server on http://localhost:${PORT} (factory: ${state.factory.name})`);
  console.log(`Auth: ${AUTH_ENABLED ? 'on (AUTH=off to disable)' : 'OFF — every visitor acts as manager'}`);
  state.factory.simulator = SIMULATOR;
  if (SIMULATOR) startSimulator();
  else console.log('Simulator off — waiting for external telemetry on POST /api/ingest or MQTT');
  startMqttBridge();
});
