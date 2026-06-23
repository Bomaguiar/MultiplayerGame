// Internal trust boundary.
//
// Identity is the phone number, proven upstream by the WhatsApp bridge. The
// watcher signs a short internal token (HMAC over phone+role+expiry) that the
// API trusts. Message *text* is never trusted to assert identity or role.

import crypto from 'crypto';

const SECRET = process.env.INTERNAL_TOKEN_SECRET || 'dev-only-insecure-secret';
const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes

function b64url(buf) {
  return Buffer.from(buf).toString('base64url');
}

/** Sign an internal token for a resolved identity. */
export function signToken({ phone, role }, ttlMs = DEFAULT_TTL_MS) {
  const payload = { phone, role, exp: Date.now() + ttlMs };
  const body = b64url(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}

/**
 * Verify and decode an internal token.
 * Returns { phone, role } on success, or null if invalid/expired/tampered.
 */
export function verifyToken(token) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  // Constant-time compare; lengths must match first.
  if (sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!payload || typeof payload.exp !== 'number' || Date.now() > payload.exp) return null;
  return { phone: payload.phone, role: payload.role };
}

/**
 * Fastify preHandler: read the internal token header and decorate req.user.
 * Absence of a token is allowed here (routes enforce via requireRole); a
 * present-but-invalid token is rejected outright.
 */
export function authDecorator(req, reply, done) {
  const token = req.headers['x-internal-token'];
  if (!token) {
    req.user = null;
    return done();
  }
  const user = verifyToken(token);
  if (!user) {
    reply.code(401).send({ error: 'invalid_token' });
    return; // do not call done() — request is terminated
  }
  req.user = user;
  done();
}
