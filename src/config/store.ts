import { readFile, writeFile, rename, chmod } from 'fs/promises';
import { randomUUID } from 'crypto';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { ConfigResponse, LegacyAppConfig, PublicConfig, SecretsConfig } from '../types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const CONFIG_PATH = join(ROOT, 'config.json');
const SECRETS_PATH = join(ROOT, 'secrets.json');

const DEFAULT_PUBLIC_CONFIG: PublicConfig = {
  calendars: [],
  widgetOrder: ['weather', 'kids', 'calendar'],
  accentColor: '#38BDF8',
  allowedHosts: [],
};

const DEFAULT_SECRETS: SecretsConfig = {
  wilma: {},
  calendarUrls: {},
};

// Atomic, mode-scoped write: write to a temp file in the same directory
// (so the rename is on the same filesystem) then rename over the target.
// A crash mid-write leaves the old file intact instead of a truncated one.
async function writeFileAtomic(path: string, data: string, mode: number): Promise<void> {
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, data, { mode, encoding: 'utf-8' });
  await rename(tmp, path);
}

let migrationDone = false;

// One-shot migration: if config.json still has the legacy shape (secrets
// inline), split it into public config.json + secrets.json and rewrite
// config.json without the sensitive fields. Idempotent — safe to call on
// every boot.
async function migrateIfNeeded(log?: { warn: (msg: string) => void }): Promise<void> {
  if (migrationDone) return;
  migrationDone = true;

  let raw: LegacyAppConfig;
  try {
    raw = JSON.parse(await readFile(CONFIG_PATH, 'utf-8'));
  } catch {
    return; // no config.json yet, or unreadable — nothing to migrate
  }

  const hasLegacySecrets =
    !!raw.wilma?.password ||
    !!raw.google ||
    (raw.calendars ?? []).some(c => !!c.url);

  if (!hasLegacySecrets) return;

  const secrets = await readSecretsRaw();
  const migratedCalendars: PublicConfig['calendars'] = [];
  const moved: string[] = [];

  for (const c of raw.calendars ?? []) {
    const id = c.id ?? randomUUID();
    migratedCalendars.push({ id, name: c.name ?? '' });
    if (c.url) {
      secrets.calendarUrls[id] = c.url;
      moved.push('a calendar URL');
    }
  }

  if (raw.wilma?.password) {
    secrets.wilma = {
      baseUrl: raw.wilma.baseUrl,
      username: raw.wilma.username,
      password: raw.wilma.password,
    };
    moved.push('the Wilma password');
  }

  if (raw.google) {
    moved.push('the (unused) Google OAuth credentials — dropped, no code reads them');
  }

  const publicConfig: PublicConfig = {
    calendars: migratedCalendars.length > 0 ? migratedCalendars : DEFAULT_PUBLIC_CONFIG.calendars,
    widgetOrder: raw.widgetOrder ?? DEFAULT_PUBLIC_CONFIG.widgetOrder,
    accentColor: raw.accentColor ?? DEFAULT_PUBLIC_CONFIG.accentColor,
    allowedHosts: DEFAULT_PUBLIC_CONFIG.allowedHosts,
  };

  await writeFileAtomic(SECRETS_PATH, JSON.stringify(secrets, null, 2), 0o600);
  await writeFileAtomic(CONFIG_PATH, JSON.stringify(publicConfig, null, 2), 0o644);

  if (moved.length > 0 && log) {
    log.warn(
      `Config migration: moved ${moved.join(', ')} out of config.json into secrets.json (mode 0600). ` +
      `config.json no longer contains any credential.`
    );
  }
}

async function readSecretsRaw(): Promise<SecretsConfig> {
  try {
    const data = await readFile(SECRETS_PATH, 'utf-8');
    const parsed = JSON.parse(data);
    return {
      wilma: parsed.wilma ?? {},
      calendarUrls: parsed.calendarUrls ?? {},
      auth: parsed.auth,
    };
  } catch {
    return { wilma: {}, calendarUrls: {} };
  }
}

export async function getPublicConfig(): Promise<PublicConfig> {
  await migrateIfNeeded();
  try {
    const data = await readFile(CONFIG_PATH, 'utf-8');
    const parsed = JSON.parse(data);
    return {
      calendars: Array.isArray(parsed.calendars) ? parsed.calendars : [],
      widgetOrder: Array.isArray(parsed.widgetOrder) ? parsed.widgetOrder : DEFAULT_PUBLIC_CONFIG.widgetOrder,
      accentColor: typeof parsed.accentColor === 'string' ? parsed.accentColor : DEFAULT_PUBLIC_CONFIG.accentColor,
      allowedHosts: Array.isArray(parsed.allowedHosts) ? parsed.allowedHosts : [],
    };
  } catch {
    return { ...DEFAULT_PUBLIC_CONFIG };
  }
}

export async function savePublicConfig(config: PublicConfig): Promise<void> {
  await writeFileAtomic(CONFIG_PATH, JSON.stringify(config, null, 2), 0o644);

  // Garbage-collect secret calendar URLs for calendars that no longer exist.
  const secrets = await getSecrets();
  const liveIds = new Set(config.calendars.map(c => c.id));
  let changed = false;
  for (const id of Object.keys(secrets.calendarUrls)) {
    if (!liveIds.has(id)) {
      delete secrets.calendarUrls[id];
      changed = true;
    }
  }
  if (changed) await saveSecrets(secrets);
}

export async function getSecrets(): Promise<SecretsConfig> {
  await migrateIfNeeded();
  return readSecretsRaw();
}

async function saveSecrets(secrets: SecretsConfig): Promise<void> {
  await writeFileAtomic(SECRETS_PATH, JSON.stringify(secrets, null, 2), 0o600);
  try {
    await chmod(SECRETS_PATH, 0o600);
  } catch {
    // best-effort; writeFileAtomic already set the mode on creation
  }
}

// Partial update — an omitted field means "leave unchanged". Empty-string
// values are treated as "leave unchanged" too, since the frontend never
// sends a secret back, so it can't distinguish "clear this" from "unset".
export async function updateSecrets(patch: {
  wilma?: { baseUrl?: string; username?: string; password?: string };
  calendarUrls?: Record<string, string>;
}): Promise<void> {
  const secrets = await getSecrets();

  if (patch.wilma) {
    secrets.wilma = {
      baseUrl: patch.wilma.baseUrl || secrets.wilma.baseUrl,
      username: patch.wilma.username || secrets.wilma.username,
      password: patch.wilma.password || secrets.wilma.password,
    };
  }

  if (patch.calendarUrls) {
    for (const [id, url] of Object.entries(patch.calendarUrls)) {
      if (url) secrets.calendarUrls[id] = url;
    }
  }

  await saveSecrets(secrets);
}

export async function setAuthRecord(record: { salt: string; hash: string }): Promise<void> {
  const secrets = await getSecrets();
  secrets.auth = record;
  await saveSecrets(secrets);
}

export async function getConfigResponse(): Promise<ConfigResponse> {
  const [pub, secrets] = await Promise.all([getPublicConfig(), getSecrets()]);
  return {
    ...pub,
    wilma: {
      baseUrl: secrets.wilma.baseUrl ?? '',
      username: secrets.wilma.username ?? '',
      passwordSet: !!secrets.wilma.password,
    },
    calendars: pub.calendars.map(c => ({ ...c, urlSet: !!secrets.calendarUrls[c.id] })),
  };
}

// Exposed for the one-time migration cleanup of legacy on-disk files (see
// scripts and index.ts) — not part of the normal read/write path.
export const paths = { CONFIG_PATH, SECRETS_PATH };
