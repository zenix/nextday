import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { SESSION_COOKIE, touchSession } from './session.js';

declare module 'fastify' {
  interface FastifyRequest {
    session?: { csrfToken: string };
  }
}

// Paths reachable with no session — the login page itself, the endpoint
// that creates a session, and the static PWA shell bits a browser needs
// before it can even show the login form.
const PUBLIC_PATHS = new Set<string>([
  '/login.html',
  '/login.css',
  '/login.js',
  '/api/login',
  '/manifest.json',
  '/sw.js',
]);

function isPublicPath(path: string): boolean {
  if (PUBLIC_PATHS.has(path)) return true;
  if (path.startsWith('/icons/')) return true;
  return false;
}

function wantsHtml(request: FastifyRequest): boolean {
  const accept = request.headers.accept || '';
  return accept.includes('text/html');
}

// Global gate: every request either carries a valid session cookie or is
// on the small public allow-list above. API calls without a session get a
// 401; page navigations get redirected to the login page.
export function registerAuthGate(app: FastifyInstance): void {
  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    if (isPublicPath(request.url.split('?')[0])) return;

    const token = request.cookies?.[SESSION_COOKIE];
    const session = token ? await touchSession(token) : null;

    if (!session) {
      if (request.url.startsWith('/api/')) {
        reply.code(401).send({ error: 'Not authenticated' });
        return;
      }
      if (wantsHtml(request)) {
        reply.redirect('/login.html', 302);
        return;
      }
      reply.code(401).send({ error: 'Not authenticated' });
      return;
    }

    request.session = { csrfToken: session.csrfToken };
  });
}
