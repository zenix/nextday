import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getSecrets } from '../config/store.js';
import { verifyPassphrase } from '../auth/passphrase.js';
import { createSession, destroySession, SESSION_COOKIE } from '../auth/session.js';
import { requireCsrf } from '../security/csrf.js';

const loginBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['passphrase'],
  properties: {
    passphrase: { type: 'string', minLength: 1, maxLength: 1000 },
  },
} as const;

// Per-IP login throttle: after LOCK_THRESHOLD failures, lock out with
// exponential backoff (capped) instead of a flat delay, so a sustained
// guesser gets slower over time rather than just hitting a fixed wall.
interface Attempt {
  failures: number;
  lockedUntil: number;
}
const attempts = new Map<string, Attempt>();
const LOCK_THRESHOLD = 10;
const BASE_LOCK_MS = 1_000;
const MAX_LOCK_MS = 30 * 60 * 1000;

function msLocked(key: string): number {
  const a = attempts.get(key);
  if (!a) return 0;
  return Math.max(0, a.lockedUntil - Date.now());
}

function recordFailure(key: string): void {
  const a = attempts.get(key) ?? { failures: 0, lockedUntil: 0 };
  a.failures++;
  if (a.failures >= LOCK_THRESHOLD) {
    a.lockedUntil = Date.now() + Math.min(MAX_LOCK_MS, BASE_LOCK_MS * 2 ** (a.failures - LOCK_THRESHOLD));
  }
  attempts.set(key, a);
}

function recordSuccess(key: string): void {
  attempts.delete(key);
}

export interface AuthRouteDeps {
  secureCookie: boolean;
}

export async function authRoutes(app: FastifyInstance, deps: AuthRouteDeps) {
  app.post('/api/login', { schema: { body: loginBodySchema } }, async (request: FastifyRequest, reply: FastifyReply) => {
    const key = request.ip;
    const wait = msLocked(key);
    if (wait > 0) {
      reply.header('Retry-After', String(Math.ceil(wait / 1000)));
      return reply.code(429).send({ error: 'Too many attempts. Try again later.' });
    }

    const { passphrase } = request.body as { passphrase: string };
    const secrets = await getSecrets();

    const ok = !!secrets.auth && (await verifyPassphrase(passphrase, secrets.auth));
    if (!ok) {
      recordFailure(key);
      return reply.code(401).send({ error: 'Invalid passphrase' });
    }
    recordSuccess(key);

    const { token, csrfToken, expiresAt } = await createSession();
    reply.setCookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'strict',
      path: '/',
      secure: deps.secureCookie,
      maxAge: Math.floor((expiresAt - Date.now()) / 1000),
    });
    return { success: true, csrfToken };
  });

  app.post('/api/logout', { preHandler: requireCsrf }, async (request: FastifyRequest, reply: FastifyReply) => {
    const token = request.cookies?.[SESSION_COOKIE];
    if (token) await destroySession(token);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { success: true };
  });

  // Lets a page that loaded from an already-valid cookie (no /api/login
  // round trip on this visit) recover the CSRF token it needs for
  // subsequent POST/PUT calls.
  app.get('/api/session', async (request: FastifyRequest) => {
    return { csrfToken: request.session!.csrfToken };
  });
}
