async function post(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `${res.status} ${res.statusText}`);
  return data;
}

export const api = {
  fetchState: () => fetch('/api/state').then((r) => r.json()),
  stationCommand: (stationId, action) => post(`/api/stations/${stationId}/command`, { action }),
  emergencyStop: () => post('/api/emergency-stop'),
  ackAlert: (alertId) => post(`/api/alerts/${alertId}/ack`),
  createOrder: (order) => post('/api/orders', order),
  setPriority: (orderId, priority) => post(`/api/orders/${orderId}/priority`, { priority }),
};
