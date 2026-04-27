import { FastifyInstance } from 'fastify';
import { AppConfig } from '../types.js';
import { readFile, writeFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = join(__dirname, '..', '..', 'config.json');

const DEFAULT_CONFIG: AppConfig = {
  calendars: [],
  widgetOrder: ['weather', 'kids', 'calendar'],
  accentColor: '#38BDF8'
};

export async function getConfig(): Promise<AppConfig> {
  try {
    const data = await readFile(CONFIG_PATH, 'utf-8');
    return JSON.parse(data);
  } catch {
    return DEFAULT_CONFIG;
  }
}

async function saveConfig(config: AppConfig) {
  await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
}

export async function configRoute(app: FastifyInstance) {
  app.get('/api/config', async () => {
    return await getConfig();
  });

  app.post('/api/config', async (request, reply) => {
    const config = request.body as AppConfig;
    
    // Basic validation
    if (!Array.isArray(config.calendars) || !Array.isArray(config.widgetOrder)) {
      return reply.code(400).send({ error: 'Invalid config format' });
    }

    await saveConfig(config);
    return { success: true };
  });
}
