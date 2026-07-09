// Telemetry ingestion — the single entry point for everything the plant floor
// reports. Real robots/PLC gateways POST these messages to /api/ingest; the
// built-in simulator calls applyTelemetry() with exactly the same payloads.
import { state, findStation, findRobot, logEvent, raiseAlert } from './store.js';
import { completeStage, dispatchOrders } from './workflow.js';

/**
 * Message shape:
 *   { kind: 'robot.telemetry',  robotId,  status?, temperatureC?, toolWearPct?, cyclesDelta? }
 *   { kind: 'station.status',   stationId, status }         // fault / maintenance / idle...
 *   { kind: 'station.progress', stationId, progress }       // % of current stage batch
 *   { kind: 'stage.completed',  stationId }                 // current batch finished
 *   { kind: 'alert',            source, severity, message }
 */
export function applyTelemetry(msg) {
  switch (msg.kind) {
    case 'robot.telemetry': {
      const robot = findRobot(msg.robotId);
      if (!robot) throw new Error(`unknown robot ${msg.robotId}`);
      if (msg.status) robot.status = msg.status;
      if (typeof msg.temperatureC === 'number') robot.temperatureC = +msg.temperatureC.toFixed(1);
      if (typeof msg.toolWearPct === 'number') robot.toolWearPct = Math.min(100, +msg.toolWearPct.toFixed(1));
      if (typeof msg.cyclesDelta === 'number') robot.cyclesTotal += msg.cyclesDelta;
      robot.lastSeen = Date.now();
      if (robot.temperatureC >= 75 && !robot._tempAlerted) {
        robot._tempAlerted = true;
        raiseAlert('warning', robot.name, `High temperature: ${robot.temperatureC}°C`);
      } else if (robot.temperatureC < 65) {
        robot._tempAlerted = false;
      }
      return robot;
    }

    case 'station.status': {
      const station = findStation(msg.stationId);
      if (!station) throw new Error(`unknown station ${msg.stationId}`);
      const prev = station.status;
      station.status = msg.status;
      station.lastSeen = Date.now();
      if (msg.status === 'fault' && prev !== 'fault') {
        for (const r of state.robots) if (r.stationId === station.id) r.status = 'fault';
        raiseAlert('serious', station.name, msg.reason ?? 'Station reported a fault — operator attention required');
      }
      if (prev === 'fault' && msg.status !== 'fault') {
        for (const r of state.robots) if (r.stationId === station.id && r.status === 'fault') r.status = 'idle';
        logEvent('station', station.name, `Fault cleared, station ${msg.status}`);
      }
      dispatchOrders();
      return station;
    }

    case 'station.progress': {
      const station = findStation(msg.stationId);
      if (!station) throw new Error(`unknown station ${msg.stationId}`);
      station.progress = Math.min(100, Math.max(0, msg.progress));
      station.lastSeen = Date.now();
      return station;
    }

    case 'stage.completed': {
      const station = findStation(msg.stationId);
      if (!station) throw new Error(`unknown station ${msg.stationId}`);
      station.lastSeen = Date.now();
      completeStage(station);
      return station;
    }

    case 'alert': {
      return raiseAlert(msg.severity ?? 'info', msg.source ?? 'external', msg.message);
    }

    default:
      throw new Error(`unknown telemetry kind: ${msg.kind}`);
  }
}
