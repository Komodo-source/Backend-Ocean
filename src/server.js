const path = require('path');

// Load .env before anything reads process.env.
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const Fastify = require('fastify');
const { pool, query } = require('./db');
const players = require('./players');
const { hashPassword, verifyPassword, signToken, requirePlayer } = require('./auth');

const app = Fastify({ logger: true });

const port = Number(process.env.PORT || 3001);
const host = process.env.HOST || '0.0.0.0';

const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:3000')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.register(require('@fastify/cors'), {
  origin: allowedOrigins.length === 1 ? allowedOrigins[0] : allowedOrigins,
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const USER_NAME_RE = /^[A-Za-z0-9_.-]{3,32}$/;
const MIN_PASSWORD_LENGTH = 8;

const isUuid = (value) => typeof value === 'string' && UUID_RE.test(value);
const badRequest = (reply, message) => reply.code(400).send({ error: message });

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

app.get('/health', async () => {
  await query('select 1');
  return { status: 'ok', database: 'connected' };
});

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

app.post('/api/auth/register', async (request, reply) => {
  const body = request.body || {};
  const userName = typeof body.user_name === 'string' ? body.user_name.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';

  if (!USER_NAME_RE.test(userName)) {
    return badRequest(
      reply,
      'user_name must be 3-32 characters using letters, numbers, underscore, dot or dash'
    );
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return badRequest(reply, `password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }

  const existing = await players.findByUserNameWithHash(userName);
  if (existing) {
    return reply.code(409).send({ error: 'user_name is already taken' });
  }

  const player = await players.create({
    userName,
    passwordHash: hashPassword(password),
  });

  return reply.code(201).send({ token: signToken(player.id_player), player });
});

app.post('/api/auth/login', async (request, reply) => {
  const body = request.body || {};
  const userName = typeof body.user_name === 'string' ? body.user_name.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';

  if (!userName || !password) {
    return badRequest(reply, 'user_name and password are required');
  }

  const row = await players.findByUserNameWithHash(userName);
  // Same response whether the account is missing or the password is wrong.
  if (!row || !verifyPassword(password, row.password_hash)) {
    return reply.code(401).send({ error: 'Invalid user_name or password' });
  }

  const player = players.toPublicPlayer(row);
  return { token: signToken(player.id_player), player };
});

/** Current player for the bearer token. */
app.get('/api/me', { preHandler: requirePlayer }, async (request, reply) => {
  const player = await players.findById(request.playerId);
  if (!player) {
    return reply.code(404).send({ error: 'Player not found' });
  }
  return player;
});

// ---------------------------------------------------------------------------
// Global Information
// ---------------------------------------------------------------------------

app.get('/api/get_leaderboard', async () => {
  const player = await players.getLeaderBoard();
  return player;
});

// ---------------------------------------------------------------------------
// Player state (all routes require a token for the same player id)
// ---------------------------------------------------------------------------

app.get('/api/player/:id', { preHandler: requirePlayer }, async (request, reply) => {
  if (!isUuid(request.params.id)) return badRequest(reply, 'id must be a uuid');

  const player = await players.findById(request.params.id);
  if (!player) {
    return reply.code(404).send({ error: 'Player not found' });
  }
  return player;
});




app.get('/api/player/:id/money_units', { preHandler: requirePlayer }, async (request, reply) => {
  if (!isUuid(request.params.id)) return badRequest(reply, 'id must be a uuid');

  const money = await players.getMoneyUnits(request.params.id);
  if (money === null) {
    return reply.code(404).send({ error: 'Player not found' });
  }
  return { money };
});

app.get('/api/player/:id/money', { preHandler: requirePlayer }, async (request, reply) => {
  if (!isUuid(request.params.id)) return badRequest(reply, 'id must be a uuid');

  const money = await players.getMoney(request.params.id);
  if (money === null) {
    return reply.code(404).send({ error: 'Player not found' });
  }
  return { money };
});

/** Save money. Body: { money } for an absolute balance or { delta } for a change. */
app.post('/api/player/:id/money', { preHandler: requirePlayer }, async (request, reply) => {
  const { id } = request.params;
  if (!isUuid(id)) return badRequest(reply, 'id must be a uuid');

  const body = request.body || {};
  const hasMoney = body.money !== undefined;
  const hasDelta = body.delta !== undefined;

  if (hasMoney === hasDelta) {
    return badRequest(reply, 'provide exactly one of "money" (absolute) or "delta"');
  }

  const value = hasMoney ? body.money : body.delta;
  if (!Number.isInteger(value)) {
    return badRequest(reply, 'money/delta must be an integer');
  }

  const player = await players.findById(id);
  if (!player) {
    return reply.code(404).send({ error: 'Player not found' });
  }

  if (hasMoney) {
    if (value < 0) return badRequest(reply, 'money cannot be negative');
    return { money: await players.setMoney(id, value) };
  }

  if (player.money + value < 0) {
    return badRequest(reply, 'not enough money');
  }
  return { money: await players.addMoney(id, value) };
});

app.get('/api/player/:id/vessels', { preHandler: requirePlayer }, async (request, reply) => {
  if (!isUuid(request.params.id)) return badRequest(reply, 'id must be a uuid');

  const player = await players.findById(request.params.id);
  if (!player) {
    return reply.code(404).send({ error: 'Player not found' });
  }
  return { vessels: await players.listVessels(request.params.id) };
});

app.put(
  '/api/player/:id/vessels/:vesselId',
  { preHandler: requirePlayer },
  async (request, reply) => {
    const { id, vesselId } = request.params;
    if (!isUuid(id)) return badRequest(reply, 'id must be a uuid');
    if (!isUuid(vesselId)) return badRequest(reply, 'vesselId must be a uuid');

    const player = await players.findById(id);
    if (!player) return reply.code(404).send({ error: 'Player not found' });

    const created = await players.attachVessel(id, vesselId);
    return reply.code(created ? 201 : 200).send({ vessel_id: vesselId, created });
  }
);

app.delete(
  '/api/player/:id/vessels/:vesselId',
  { preHandler: requirePlayer },
  async (request, reply) => {
    const { id, vesselId } = request.params;
    if (!isUuid(id)) return badRequest(reply, 'id must be a uuid');
    if (!isUuid(vesselId)) return badRequest(reply, 'vesselId must be a uuid');

    const removed = await players.detachVessel(id, vesselId);
    if (!removed) return reply.code(404).send({ error: 'Vessel not owned by player' });
    return reply.code(204).send();
  }
);

app.get('/api/player/:id/ports', { preHandler: requirePlayer }, async (request, reply) => {
  if (!isUuid(request.params.id)) return badRequest(reply, 'id must be a uuid');

  const player = await players.findById(request.params.id);
  if (!player) {
    return reply.code(404).send({ error: 'Player not found' });
  }
  return { ports: await players.listPorts(request.params.id) };
});

app.put(
  '/api/player/:id/ports/:portId',
  { preHandler: requirePlayer },
  async (request, reply) => {
    const { id, portId } = request.params;
    if (!isUuid(id)) return badRequest(reply, 'id must be a uuid');
    if (!isUuid(portId)) return badRequest(reply, 'portId must be a uuid');

    const player = await players.findById(id);
    if (!player) return reply.code(404).send({ error: 'Player not found' });

    const created = await players.attachPort(id, portId);
    return reply.code(created ? 201 : 200).send({ port_id: portId, created });
  }
);

app.delete(
  '/api/player/:id/ports/:portId',
  { preHandler: requirePlayer },
  async (request, reply) => {
    const { id, portId } = request.params;
    if (!isUuid(id)) return badRequest(reply, 'id must be a uuid');
    if (!isUuid(portId)) return badRequest(reply, 'portId must be a uuid');

    const removed = await players.detachPort(id, portId);
    if (!removed) return reply.code(404).send({ error: 'Port not owned by player' });
    return reply.code(204).send();
  }
);

// ---------------------------------------------------------------------------
// Errors + startup
// ---------------------------------------------------------------------------

app.setErrorHandler((error, request, reply) => {
  request.log.error(error);

  switch (error.code) {
    case '23505':
      return reply.code(409).send({ error: 'Resource already exists' });
    case '23503':
      return reply.code(400).send({ error: 'Referenced record does not exist' });
    case '23514':
      return reply.code(400).send({ error: 'Value violates a database constraint' });
    case '22P02':
      return reply.code(400).send({ error: 'Invalid input syntax' });
    case 'ECONNREFUSED':
    case 'ENOTFOUND':
    case 'ETIMEDOUT':
      return reply.code(503).send({ error: 'Database unavailable' });
    default:
      break;
  }

  if (error.statusCode && error.statusCode < 500) {
    return reply.code(error.statusCode).send({ error: error.message });
  }

  return reply.code(500).send({ error: 'Internal server error' });
});

async function start() {
  try {
    await query('select 1');
    await app.listen({ port, host });
  } catch (error) {
    app.log.error(error);
    process.exitCode = 1;
  }
}

async function shutdown(signal) {
  app.log.info(`${signal} received, shutting down`);
  await app.close();
  await pool.end();
  process.exit(0);
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));

start();
