import { FastifyInstance } from 'fastify';
import helmet from '@fastify/helmet';

export async function registerSecurityHeaders(app: FastifyInstance, opts: { tlsEnabled: boolean }): Promise<void> {
  await app.register(helmet, {
    contentSecurityPolicy: {
      // useDefaults: false — we want exactly the directives listed below,
      // not helmet's own baked-in extras merged on top. In particular,
      // helmet's defaults include `upgrade-insecure-requests`, which on a
      // plain-HTTP LAN deployment (the default — see NEXTDAY_TLS_* in
      // src/index.ts) would make the browser try to upgrade every fetch()
      // call to https:// and fail, since there's no HTTPS listener. Only
      // add it back (below) when TLS is actually enabled.
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        // Style stays 'unsafe-inline': the page is built on inline `style=`
        // attributes throughout (see public/index.html). That's a lot of
        // markup to rewrite for no script-execution benefit — inline CSS
        // can't run script. Everything script-related is 'self' only.
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        frameAncestors: ["'none'"],
        baseUri: ["'none'"],
        objectSrc: ["'none'"],
        formAction: ["'self'"],
        ...(opts.tlsEnabled ? { upgradeInsecureRequests: [] } : {}),
      },
    },
    referrerPolicy: { policy: 'no-referrer' },
    // Local HTTP by default (see NEXTDAY_TLS_* in src/index.ts) — HSTS
    // would be actively harmful without TLS, and helmet only sends it over
    // an already-HTTPS connection anyway.
    hsts: opts.tlsEnabled,
  });

  app.addHook('onSend', async (request, reply, payload) => {
    if (request.url.startsWith('/api/')) {
      reply.header('Cache-Control', 'no-store');
    }
    return payload;
  });
}
