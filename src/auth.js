const crypto = require('crypto');

const SCRYPT_KEY_LENGTH = 64;
const DEFAULT_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function sessionSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error(
      'SESSION_SECRET is required to sign session tokens. Set it in .env.'
    );
  }
  return secret;
}

function sessionTtlMs() {
  const ttl = Number(process.env.SESSION_TTL_MS);
  return Number.isFinite(ttl) && ttl > 0 ? ttl : DEFAULT_SESSION_TTL_MS;
}

/** Hash a password with scrypt (no external dependency). */
function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(password, salt, SCRYPT_KEY_LENGTH);
  return `scrypt$${salt.toString('base64')}$${derived.toString('base64')}`;
}

/** Constant-time password check against the value stored in player.password_hash. */
function verifyPassword(password, stored) {
  if (typeof stored !== 'string') return false;

  const [scheme, saltPart, hashPart] = stored.split('$');
  if (scheme !== 'scrypt' || !saltPart || !hashPart) return false;

  const salt = Buffer.from(saltPart, 'base64');
  const expected = Buffer.from(hashPart, 'base64');
  const actual = crypto.scryptSync(password, salt, expected.length);

  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

/**
 * Stateless session token: base64url(payload).base64url(hmac).
 * Avoids needing a sessions table while still being tamper-proof.
 */
function signToken(playerId) {
  const payload = Buffer.from(
    JSON.stringify({ sub: playerId, exp: Date.now() + sessionTtlMs() })
  ).toString('base64url');

  const signature = crypto
    .createHmac('sha256', sessionSecret())
    .update(payload)
    .digest('base64url');

  return `${payload}.${signature}`;
}

/** Returns { playerId, expiresAt } or null when the token is invalid/expired. */
function verifyToken(token) {
  if (typeof token !== 'string') return null;

  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;

  const expected = crypto
    .createHmac('sha256', sessionSecret())
    .update(payload)
    .digest('base64url');

  const providedBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (
    providedBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(providedBuffer, expectedBuffer)
  ) {
    return null;
  }

  let data;
  try {
    data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }

  if (!data || typeof data.sub !== 'string' || typeof data.exp !== 'number') return null;
  if (Date.now() > data.exp) return null;

  return { playerId: data.sub, expiresAt: data.exp };
}

/**
 * Fastify preHandler: requires a valid Bearer token and, when the route has an
 * :id param, that the token belongs to that player.
 */
async function requirePlayer(request, reply) {
  const header = request.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (!/^bearer$/i.test(scheme || '') || !token) {
    return reply.code(401).send({ error: 'Missing bearer token' });
  }

  const session = verifyToken(token);
  if (!session) {
    return reply.code(401).send({ error: 'Invalid or expired token' });
  }

  if (request.params && request.params.id && request.params.id !== session.playerId) {
    return reply.code(403).send({ error: 'Token does not belong to this player' });
  }

  request.playerId = session.playerId;
  return undefined;
}

module.exports = {
  hashPassword,
  verifyPassword,
  signToken,
  verifyToken,
  requirePlayer,
};
