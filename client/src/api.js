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

async function send(method, url, body) {
  const res = await fetch(url, {
    method,
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
  // designer
  createStationType: (body) => send('POST', '/api/station-types', body),
  updateStationType: (id, body) => send('PUT', `/api/station-types/${id}`, body),
  deleteStationType: (id) => send('DELETE', `/api/station-types/${id}`),
  createWorkflow: (body) => send('POST', '/api/workflows', body),
  updateWorkflow: (id, body) => send('PUT', `/api/workflows/${id}`, body),
  deleteWorkflow: (id) => send('DELETE', `/api/workflows/${id}`),
  placeStation: (body) => send('POST', '/api/stations', body),
  updateStation: (id, body) => send('PATCH', `/api/stations/${id}`, body),
  removeStation: (id) => send('DELETE', `/api/stations/${id}`),
  createProject: (body) => send('POST', '/api/projects', body),
  updateProject: (id, body) => send('PATCH', `/api/projects/${id}`, body),
  updateFactory: (body) => send('PATCH', '/api/factory', body),
  createInventoryItem: (body) => send('POST', '/api/inventory', body),
  adoptMeasured: (typeId) => send('POST', `/api/station-types/${typeId}/adopt-measured`),
  cancelOrder: (orderId) => send('POST', `/api/orders/${orderId}/cancel`),
  rerouteOrder: (orderId) => send('POST', `/api/orders/${orderId}/reroute`),
  adjustStock: (sku, qtyDelta) => send('PATCH', `/api/inventory/${sku}`, { qtyDelta }),
  updateInventoryItem: (sku, body) => send('PATCH', `/api/inventory/${sku}`, body),
  deleteInventoryItem: (sku) => send('DELETE', `/api/inventory/${sku}`),
  // auth
  me: () => send('GET', '/api/auth/me'),
  login: (username, password) => send('POST', '/api/auth/login', { username, password }),
  logout: () => send('POST', '/api/auth/logout'),
  changePassword: (current, next) => send('POST', '/api/auth/password', { current, next }),
  listUsers: () => send('GET', '/api/auth/users'),
  addUser: (body) => send('POST', '/api/auth/users', body),
  deleteUser: (username) => send('DELETE', `/api/auth/users/${username}`),
};
