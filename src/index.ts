import 'dotenv/config';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { dayRoute } from './routes/day.js';
import { configRoute } from './routes/config.js';
import { metaRoute } from './routes/meta.js';
import { WilmaClient } from '@wilm-ai/wilma-client';
import { WilmaConfig } from './sources/wilma.js';

import { getConfig } from './routes/config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

let wilmaConfig: WilmaConfig | null = null;

async function refreshWilmaConfig(log: any) {
  const config = await getConfig();
  const baseUrl = config.wilma?.baseUrl || process.env.WILMA_BASE_URL;
  const username = config.wilma?.username || process.env.WILMA_USERNAME;
  const password = config.wilma?.password || process.env.WILMA_PASSWORD;

  if (baseUrl && username && password) {
    log.info('Fetching Wilma student list...');
    try {
      const profile = { baseUrl, username, password };
      const students = await WilmaClient.listStudents(profile);
      log.info(`Found ${students.length} Wilma students: ${students.map(s => s.name).join(', ')}`);
      wilmaConfig = { profile, students };
    } catch (err) {
      log.error('Failed to fetch Wilma student list: ' + err);
      wilmaConfig = null;
    }
  } else {
    log.warn('Wilma credentials missing, Wilma integration disabled.');
    wilmaConfig = null;
  }
}

async function startServer() {
  const app = Fastify({ logger: true });

  app.register(fastifyStatic, {
    root: join(__dirname, '..', 'public'),
    prefix: '/',
  });

  await refreshWilmaConfig(app.log);

  app.register(configRoute);
  
  // Custom hook to refresh Wilma config when settings are saved
  app.addHook('onResponse', async (request, reply) => {
    if (request.method === 'POST' && request.url === '/api/config' && reply.statusCode === 200) {
      await refreshWilmaConfig(app.log);
    }
  });

  app.register(async (instance) => {
    instance.get('/api/meta', async () => {
      return {
        students: wilmaConfig?.students.map(s => s.name) || [],
        version: '1.0.0',
        status: 'ok'
      };
    });
    
    await dayRoute(instance, () => wilmaConfig);
  });

  try {
    const port = Number(process.env.PORT) || 3000;
    await app.listen({ port, host: '0.0.0.0' });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

startServer();
