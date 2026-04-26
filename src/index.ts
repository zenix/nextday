import 'dotenv/config';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { dayRoute } from './routes/day.js';
import { WilmaClient } from '@wilm-ai/wilma-client';
import { WilmaConfig } from './sources/wilma.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function startServer() {
  const app = Fastify({ logger: true });

  app.register(fastifyStatic, {
    root: join(__dirname, '..', 'public'),
    prefix: '/',
  });

  let wilmaConfig: WilmaConfig | null = null;

  if (process.env.WILMA_USERNAME && process.env.WILMA_PASSWORD && process.env.WILMA_BASE_URL) {
    app.log.info('Fetching Wilma student list...');
    try {
      const profile = {
        baseUrl: process.env.WILMA_BASE_URL,
        username: process.env.WILMA_USERNAME,
        password: process.env.WILMA_PASSWORD,
      };
      const students = await WilmaClient.listStudents(profile);
      app.log.info(`Found ${students.length} Wilma students: ${students.map(s => s.name).join(', ')}`);
      wilmaConfig = { profile, students };
    } catch (err) {
      app.log.error('Failed to fetch Wilma student list: ' + err);
    }
  } else {
    app.log.warn('Wilma credentials missing in .env, Wilma integration disabled.');
  }

  app.register(async (instance) => {
    await dayRoute(instance, wilmaConfig);
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
