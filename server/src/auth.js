// Login + roles. Two roles: "manager" (can design stations/workflows, edit the
// floor and projects) and "operator" (can run the plant: commands, orders,
// alert acks). Users live in data/users.json with scrypt-hashed passwords;
// sessions are HMAC-signed tokens in an httpOnly cookie. Disable the whole
// layer with AUTH=off (every request then acts as a dev manager).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Router } from 'express';

export const AUTH_ENABLED = process.env.AUTH !== 'off';
const SESSION_HOURS = 12;
const COOKIE = 'rf_token';

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SECRET_FILE = path.join(DATA_DIR, 'auth-secret');

fs.mkdirSync(DATA_DIR, { recursive: true });

function loadSecret() {
  try {
    return fs.readFileSync(SECRET_FILE, 'utf8').trim();
  } catch {
    const secret = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(SECRET_FILE, secret, { mode: 0o600 });
    return secret;
  }
}
const SECRET = loadSecret();

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function makeUser(username, role, password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return { username, role, salt, hash: hashPassword(password, salt) };
}

function loadUsers() {
  try {
    return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  } catch {
    const users = [makeUser('manager', 'manager', 'manager123'), makeUser('operator', 'operator', 'operator123')];
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), { mode: 0o600 });
    console.log('Auth: created default users — manager/manager123 and operator/operator123 (change them via POST /api/auth/password)');
    return users;
  }
}
const users = loadUsers();
const saveUsers = () => fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), { mode: 0o600 });

// ---- tokens ---------------------------------------------------------------------
function sign(username, role) {
  const payload = Buffer.from(JSON.stringify({ u: username, r: role, exp: Date.now() + SESSION_HOURS * 3600e3 })).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function verify(token) {
  if (!token) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expected = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (data.exp < Date.now()) return null;
    return { username: data.u, role: data.r };
  } catch {
    return null;
  }
}

function cookieToken(req) {
  const raw = req.headers.cookie ?? '';
  for (const part of raw.split(';')) {
    const [k, v] = part.trim().split('=');
    if (k === COOKIE) return v;
  }
  return null;
}

// Shared by HTTP middleware and the WebSocket upgrade check.
export function userFromRequest(req) {
  if (!AUTH_ENABLED) return { username: 'dev', role: 'manager' };
  return verify(cookieToken(req));
}

// ---- middleware -----------------------------------------------------------------
export function attachUser(req, _res, next) {
  req.user = userFromRequest(req);
  next();
}

export const requireUser = (req, res, next) =>
  req.user ? next() : res.status(401).json({ error: 'login required' });

export const requireManager = (req, res, next) =>
  req.user?.role === 'manager' ? next() : res.status(403).json({ error: 'manager role required' });

// Machine-facing endpoints (telemetry in, command queue out). Open by default;
// set INGEST_TOKEN to require an x-api-key header from gateways.
export function gatewayGuard(req, res, next) {
  const token = process.env.INGEST_TOKEN;
  if (token && req.headers['x-api-key'] !== token) {
    return res.status(401).json({ error: 'invalid api key' });
  }
  next();
}

// ---- routes ---------------------------------------------------------------------
export const authRouter = Router();

authRouter.post('/login', (req, res) => {
  const { username, password } = req.body ?? {};
  const user = users.find((u) => u.username === username);
  if (!user || user.hash !== hashPassword(password ?? '', user.salt)) {
    return res.status(401).json({ error: 'wrong username or password' });
  }
  res.setHeader('Set-Cookie',
    `${COOKIE}=${sign(user.username, user.role)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_HOURS * 3600}`);
  res.json({ username: user.username, role: user.role });
});

authRouter.post('/logout', (_req, res) => {
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`);
  res.json({ ok: true });
});

authRouter.get('/me', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'login required' });
  res.json(req.user);
});

// ---- user management (manager only) ----------------------------------------------
const managerOnly = (req, res, next) =>
  req.user?.role === 'manager' ? next() : res.status(403).json({ error: 'manager role required' });

authRouter.get('/users', managerOnly, (_req, res) => {
  res.json(users.map(({ username, role }) => ({ username, role })));
});

authRouter.post('/users', managerOnly, (req, res) => {
  const username = String(req.body.username ?? '').trim().toLowerCase();
  const role = req.body.role === 'manager' ? 'manager' : 'operator';
  const password = String(req.body.password ?? '');
  if (!/^[a-z0-9_.-]{2,24}$/.test(username)) {
    return res.status(400).json({ error: 'username: 2-24 chars, letters/digits/._- only' });
  }
  if (users.some((u) => u.username === username)) return res.status(400).json({ error: 'that username already exists' });
  if (password.length < 6) return res.status(400).json({ error: 'password must be at least 6 characters' });
  users.push(makeUser(username, role, password));
  saveUsers();
  res.status(201).json({ username, role });
});

authRouter.delete('/users/:username', managerOnly, (req, res) => {
  const username = req.params.username;
  const user = users.find((u) => u.username === username);
  if (!user) return res.status(404).json({ error: 'unknown user' });
  if (username === req.user.username) return res.status(400).json({ error: 'you cannot delete yourself' });
  if (user.role === 'manager' && users.filter((u) => u.role === 'manager').length === 1) {
    return res.status(400).json({ error: 'cannot delete the last manager' });
  }
  users.splice(users.indexOf(user), 1);
  saveUsers();
  res.json({ ok: true });
});

authRouter.post('/password', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'login required' });
  const { current, next: nextPw } = req.body ?? {};
  const user = users.find((u) => u.username === req.user.username);
  if (!user || user.hash !== hashPassword(current ?? '', user.salt)) {
    return res.status(401).json({ error: 'current password is wrong' });
  }
  if (!nextPw || String(nextPw).length < 6) return res.status(400).json({ error: 'new password must be at least 6 characters' });
  user.salt = crypto.randomBytes(16).toString('hex');
  user.hash = hashPassword(String(nextPw), user.salt);
  saveUsers();
  res.json({ ok: true });
});
