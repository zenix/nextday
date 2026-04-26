import { FastifyInstance } from 'fastify';
import { WilmaConfig } from '../sources/wilma.js';

export async function metaRoute(app: FastifyInstance, wilmaConfig: WilmaConfig | null) {
  app.get('/api/meta', async () => {
    return {
      students: wilmaConfig?.students.map(s => s.name) || [],
      version: '1.0.0',
      status: 'ok'
    };
  });
}
