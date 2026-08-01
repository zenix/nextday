import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getConfigResponse, getPublicConfig, savePublicConfig, updateSecrets } from '../config/store.js';
import { assertSafeUrl, UnsafeUrlError } from '../net/safeFetch.js';
import { PublicConfig } from '../types.js';

const configBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['calendars', 'widgetOrder', 'accentColor'],
  properties: {
    calendars: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'name'],
        properties: {
          id: { type: 'string', minLength: 1, maxLength: 200 },
          name: { type: 'string', maxLength: 200 },
        },
      },
    },
    widgetOrder: { type: 'array', items: { type: 'string', enum: ['weather', 'kids', 'calendar'] } },
    accentColor: { type: 'string', pattern: '^#[0-9A-Fa-f]{6}$' },
    allowedHosts: { type: 'array', items: { type: 'string', maxLength: 255 } },
  },
} as const;

const secretsBodySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    wilma: {
      type: 'object',
      additionalProperties: false,
      properties: {
        baseUrl: { type: 'string', maxLength: 500 },
        username: { type: 'string', maxLength: 320 },
        password: { type: 'string', maxLength: 500 },
      },
    },
    calendarUrls: {
      type: 'object',
      additionalProperties: { type: 'string', maxLength: 2000 },
    },
  },
} as const;

export interface ConfigRouteDeps {
  onConfigSaved: () => Promise<void>;
  // CSRF/host checks run as global hooks (src/security), so nothing extra
  // is needed here — this preHandler is just where those hooks attach for
  // state-changing methods, kept for clarity in the route list.
  requireCsrf: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
}

export async function configRoute(app: FastifyInstance, deps: ConfigRouteDeps) {
  app.get('/api/config', async () => {
    return getConfigResponse();
  });

  app.post('/api/config', { preHandler: deps.requireCsrf, schema: { body: configBodySchema } }, async (request, reply) => {
    const body = request.body as PublicConfig;

    const ids = new Set<string>();
    for (const c of body.calendars) {
      if (ids.has(c.id)) return reply.code(400).send({ error: 'Duplicate calendar id' });
      ids.add(c.id);
    }

    const current = await getPublicConfig();
    await savePublicConfig({
      calendars: body.calendars,
      widgetOrder: body.widgetOrder,
      accentColor: body.accentColor,
      allowedHosts: body.allowedHosts ?? current.allowedHosts,
    });

    await deps.onConfigSaved();
    return { success: true };
  });

  app.put('/api/secrets', { preHandler: deps.requireCsrf, schema: { body: secretsBodySchema } }, async (request, reply) => {
    const body = request.body as { wilma?: { baseUrl?: string; username?: string; password?: string }; calendarUrls?: Record<string, string> };

    if (body.calendarUrls) {
      const config = await getPublicConfig();
      const knownIds = new Set(config.calendars.map(c => c.id));
      for (const [id, url] of Object.entries(body.calendarUrls)) {
        if (!knownIds.has(id)) {
          return reply.code(400).send({ error: `Unknown calendar id "${id}" — save the calendar first` });
        }
        try {
          await assertSafeUrl(url);
        } catch (err) {
          if (err instanceof UnsafeUrlError) return reply.code(400).send({ error: `Calendar URL rejected: ${err.message}` });
          throw err;
        }
      }
    }

    await updateSecrets(body);
    await deps.onConfigSaved();
    return { success: true };
  });
}
