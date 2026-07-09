// Operator commands from the control room. In a live plant these would be
// forwarded to the station PLC / robot controller; here they mutate state
// directly and the simulator honors the resulting status.
import { state, findStation, logEvent, raiseAlert } from './store.js';
import { dispatchOrders } from './workflow.js';

export function stationCommand(stationId, action, issuedBy = 'operator') {
  const station = findStation(stationId);
  if (!station) throw new Error(`unknown station ${stationId}`);

  switch (action) {
    case 'start':
      if (station.status === 'fault') throw new Error('reset the fault before starting');
      station.status = station.currentOrderId ? 'running' : 'idle';
      for (const r of state.robots) {
        if (r.stationId === station.id && r.status !== 'fault') {
          r.status = station.currentOrderId ? 'working' : 'idle';
        }
      }
      break;
    case 'pause':
      if (station.status !== 'running') throw new Error('station is not running');
      station.status = 'paused';
      for (const r of state.robots) if (r.stationId === station.id && r.status === 'working') r.status = 'paused';
      break;
    case 'stop':
      station.status = 'stopped';
      for (const r of state.robots) if (r.stationId === station.id && r.status !== 'fault') r.status = 'idle';
      break;
    case 'reset_fault':
      if (station.status !== 'fault') throw new Error('station has no active fault');
      station.status = 'idle';
      for (const r of state.robots) if (r.stationId === station.id && r.status === 'fault') r.status = 'idle';
      break;
    default:
      throw new Error(`unknown action ${action}`);
  }
  station.lastSeen = Date.now();
  logEvent('command', issuedBy, `${action.replace('_', ' ')} → ${station.name}`);
  dispatchOrders();
  return station;
}

export function emergencyStop(issuedBy = 'operator') {
  for (const station of state.stations) {
    if (station.status !== 'fault') station.status = 'stopped';
  }
  for (const robot of state.robots) {
    if (robot.status !== 'fault') robot.status = 'idle';
  }
  raiseAlert('critical', issuedBy, 'EMERGENCY STOP issued — all stations halted');
  return state.stations;
}

export function acknowledgeAlert(alertId, issuedBy = 'operator') {
  const alert = state.alerts.find((a) => a.id === alertId);
  if (!alert) throw new Error(`unknown alert ${alertId}`);
  alert.acknowledged = true;
  alert.acknowledgedAt = Date.now();
  logEvent('command', issuedBy, `Alert acknowledged: ${alert.message}`);
  return alert;
}

export function setOrderPriority(orderId, priority) {
  const order = state.orders.find((o) => o.id === orderId);
  if (!order) throw new Error(`unknown order ${orderId}`);
  order.priority = priority;
  logEvent('command', 'operator', `${order.code} priority set to ${priority}`);
  dispatchOrders();
  return order;
}
