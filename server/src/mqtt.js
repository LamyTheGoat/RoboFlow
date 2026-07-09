// Optional MQTT bridge for two-way integration with real equipment.
// Enabled by setting MQTT_URL (e.g. mqtt://broker.local:1883).
//
//   telemetry IN:  gateways publish the same JSON messages as POST /api/ingest
//                  to `roboflow/telemetry` (single message or array)
//   commands OUT:  every operator command is published to
//                  `roboflow/commands/<stationId>` (or .../all for e-stop)
//
// The HTTP ingest endpoint and the polling command queue keep working
// alongside this — MQTT is an additional transport, not a replacement.
import { logEvent, subscribe } from './store.js';
import { applyTelemetry } from './ingest.js';

export async function startMqttBridge() {
  const url = process.env.MQTT_URL;
  if (!url) return;

  let mqtt;
  try {
    mqtt = await import('mqtt');
  } catch {
    console.error('MQTT_URL is set but the "mqtt" package is missing — run npm install in server/');
    return;
  }

  const client = mqtt.default.connect(url, {
    username: process.env.MQTT_USERNAME,
    password: process.env.MQTT_PASSWORD,
    reconnectPeriod: 3000,
  });

  client.on('connect', () => {
    console.log(`MQTT bridge connected to ${url}`);
    logEvent('system', 'mqtt-bridge', `Connected to broker — telemetry on roboflow/telemetry, commands on roboflow/commands/#`);
    client.subscribe('roboflow/telemetry');
  });

  client.on('message', (_topic, payload) => {
    try {
      const parsed = JSON.parse(payload.toString());
      for (const msg of Array.isArray(parsed) ? parsed : [parsed]) {
        try {
          applyTelemetry(msg);
        } catch (err) {
          console.warn('MQTT telemetry rejected:', err.message);
        }
      }
    } catch {
      console.warn('MQTT telemetry ignored: payload is not JSON');
    }
  });

  client.on('error', (err) => console.warn('MQTT error:', err.message));
  client.on('offline', () => logEvent('system', 'mqtt-bridge', 'Broker connection lost — retrying'));

  // Push every operator command out as it happens.
  subscribe((message) => {
    if (message.type === 'command') {
      client.publish(`roboflow/commands/${message.command.target}`, JSON.stringify(message.command), { qos: 1 });
    }
  });
}
