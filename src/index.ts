import Fastify, { FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyCookie from '@fastify/cookie';
import fastifyRateLimit from '@fastify/rate-limit';
import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { dayRoute } from './routes/day.js';
import { configRoute } from './routes/config.js';
import { authRoutes } from './routes/auth.js';
import { WilmaClient } from '@wilm-ai/wilma-client';
import { WilmaConfig } from './sources/wilma.js';
import { loadCacheFromDisk, refreshCalendarCache } from './sources/calendar.js';
import { loadHolidayCacheFromDisk, refreshHolidayCache } from './sources/holidays.js';
import { getSecrets } from './config/store.js';
import { registerHostCheck, refreshAllowedHosts } from './security/hostCheck.js';
import { registerAuthGate } from './auth/hook.js';
import { requireCsrf } from './security/csrf.js';
import { registerSecurityHeaders } from './security/headers.js';
import { loadSessionsFromDisk, pruneExpiredSessions } from './auth/session.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

let wilmaConfig: WilmaConfig | null = null;

async function refreshWilmaConfig(log: any) {
  const secrets = await getSecrets();
  const baseUrl = secrets.wilma.baseUrl;
  const username = secrets.wilma.username;
  const password = secrets.wilma.password;

  if (baseUrl && username && password) {
    log.info('Fetching Wilma student list...');
    try {
      const profile = { baseUrl, username, password };
      const students = await WilmaClient.listStudents(profile);
      log.info(`Found ${students.length} Wilma student(s)`);
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

// Called after any successful config or secrets write — re-derives
// everything that's cached from those files.
async function onConfigSaved(log: any) {
  await Promise.all([
    refreshWilmaConfig(log),
    refreshCalendarCache(log).catch(err => log.error('Calendar refresh error: ' + err)),
    refreshAllowedHosts(),
  ]);
}

async function startServer() {
  const host = process.env.NEXTDAY_HOST || '127.0.0.1';
  const port = Number(process.env.NEXTDAY_PORT) || 3000;

  const tlsCertPath = process.env.NEXTDAY_TLS_CERT;
  const tlsKeyPath = process.env.NEXTDAY_TLS_KEY;
  const tlsEnabled = !!(tlsCertPath && tlsKeyPath);

  const loggerOpts = {
    level: 'info' as const,
    redact: ['req.headers.cookie', 'req.headers.authorization'],
  };
  const bodyLimit = 64 * 1024;

  // Fastify's constructor overloads pick the server generic (http vs https
  // vs http2) from the literal shape of the options object, so the two
  // branches are constructed separately rather than via one options object
  // with an optional `https` field. Only Fastify's own request/reply API is
  // used anywhere downstream (never the raw `.server`), so collapsing both
  // branches to the plain FastifyInstance type here is safe.
  const app: FastifyInstance = tlsEnabled
    ? (Fastify({
        logger: loggerOpts,
        https: { cert: await readFile(tlsCertPath!), key: await readFile(tlsKeyPath!) },
        bodyLimit,
      }) as unknown as FastifyInstance)
    : Fastify({ logger: loggerOpts, bodyLimit });

  // Passphrase is required before the server will bind at all — no window
  // where the app is reachable unauthenticated.
  const secrets = await getSecrets();
  if (!secrets.auth) {
    console.error(
      '\nNo passphrase configured. Run this first, then start the server again:\n\n' +
      '  npm run set-passphrase\n'
    );
    process.exit(1);
  }

  await app.register(fastifyCookie);
  await app.register(fastifyRateLimit, { max: 300, timeWindow: '1 minute' });
  await registerSecurityHeaders(app, { tlsEnabled });

  // Order matters: reject spoofed Host headers before anything else runs,
  // then require a session, before any route handler (including static
  // file serving) executes.
  registerHostCheck(app);
  registerAuthGate(app);

  app.register(fastifyStatic, {
    root: join(__dirname, '..', 'public'),
    prefix: '/',
  });

  await loadSessionsFromDisk(app.log);
  setInterval(pruneExpiredSessions, 60 * 60 * 1000);

  await refreshWilmaConfig(app.log);
  await refreshAllowedHosts();
  await loadCacheFromDisk(app.log);
  await loadHolidayCacheFromDisk(app.log);
  refreshCalendarCache(app.log).catch(err => app.log.error('Initial calendar refresh failed: ' + err));
  refreshHolidayCache(app.log).catch(err => app.log.error('Holiday fetch failed: ' + err));
  setInterval(() => refreshCalendarCache(app.log), 30 * 60 * 1000);

  await app.register(authRoutes, { secureCookie: tlsEnabled });
  await app.register(configRoute, {
    requireCsrf,
    onConfigSaved: () => onConfigSaved(app.log),
  });

  app.get('/api/meta', async () => ({
    students: wilmaConfig?.students.map(s => s.name) || [],
    version: '1.0.0',
    status: 'ok',
  }));

  await dayRoute(app, () => wilmaConfig);

  try {
    await app.listen({ port, host });
    const scheme = tlsEnabled ? 'https' : 'http';
    console.log(`\n🚀 Nextday is running!`);
    console.log(`📱 Access it at: ${scheme}://localhost:${port}`);
    if (host === '0.0.0.0') {
      console.log(`🌐 On other devices: ${scheme}://YOUR_TABLET_IP:${port}`);
    } else {
      console.log(`   (bound to ${host} only — set NEXTDAY_HOST=0.0.0.0 to allow other devices on your LAN)`);
    }
    if (!tlsEnabled) {
      console.log(`⚠️  Running over plain HTTP — the passphrase and session cookie travel in cleartext.`);
      console.log(`   Set NEXTDAY_TLS_CERT / NEXTDAY_TLS_KEY to enable HTTPS (see README).`);
    }
    console.log('');
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

startServer();
