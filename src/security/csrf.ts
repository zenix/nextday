import { FastifyRequest, FastifyReply } from 'fastify';

// Double-submit CSRF check for state-changing routes. SameSite=Strict on
// the session cookie already blocks the common case (a form or fetch from
// another origin never attaches the cookie at all), but this is defense in
// depth for older browsers / edge cases, and it's cheap.
export async function requireCsrf(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const origin = request.headers.origin;
  if (origin) {
    let originHost: string | null = null;
    try {
      originHost = new URL(origin).host.toLowerCase();
    } catch {
      // malformed Origin — fall through to reject below
    }
    if (!originHost || originHost !== (request.headers.host || '').toLowerCase()) {
      reply.code(403).send({ error: 'Cross-origin request rejected' });
      return;
    }
  }

  const provided = request.headers['x-csrf-token'];
  if (!request.session || provided !== request.session.csrfToken) {
    reply.code(403).send({ error: 'Missing or invalid CSRF token' });
  }
}
