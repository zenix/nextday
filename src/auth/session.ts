import { randomBytes, createHash } from 'crypto';
import { readFile, writeFile, rename } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SESSIONS_PATH = join(__dirname, '..', '..', 'sessions.json');

export const SESSION_COOKIE = 'nextday_session';
const SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days — a wall tablet shouldn't need to re-login
// Renew (push expiry back out to a fresh 90 days) once less than this much
// life is left, so an active session never actually expires but we're not
// rewriting the session file on every request either.
const RENEW_THRESHOLD_MS = 14 * 24 * 60 * 60 * 1000;

interface SessionRecord {
  tokenHash: string; // sha256(token), hex — never store the raw token
  createdAt: number;
  expiresAt: number;
  csrfToken: string;
}

const sessions = new Map<string, SessionRecord>(); // keyed by tokenHash

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

async function persist(): Promise<void> {
  const data = JSON.stringify(Array.from(sessions.values()), null, 2);
  const tmp = `${SESSIONS_PATH}.${process.pid}.tmp`;
  await writeFile(tmp, data, { mode: 0o600, encoding: 'utf-8' });
  await rename(tmp, SESSIONS_PATH);
}

export async function loadSessionsFromDisk(log?: { info: (msg: string) => void }): Promise<void> {
  try {
    const data = await readFile(SESSIONS_PATH, 'utf-8');
    const records: SessionRecord[] = JSON.parse(data);
    const now = Date.now();
    for (const r of records) {
      if (r.expiresAt > now) sessions.set(r.tokenHash, r);
    }
    log?.info(`Sessions: loaded ${sessions.size} active session(s) from disk`);
  } catch {
    // no sessions file yet
  }
}

export function pruneExpiredSessions(): void {
  const now = Date.now();
  let removed = false;
  for (const [key, record] of sessions) {
    if (record.expiresAt <= now) {
      sessions.delete(key);
      removed = true;
    }
  }
  if (removed) void persist();
}

export async function createSession(): Promise<{ token: string; csrfToken: string; expiresAt: number }> {
  const token = randomBytes(32).toString('base64url');
  const csrfToken = randomBytes(32).toString('base64url');
  const now = Date.now();
  const record: SessionRecord = {
    tokenHash: hashToken(token),
    createdAt: now,
    expiresAt: now + SESSION_TTL_MS,
    csrfToken,
  };
  sessions.set(record.tokenHash, record);
  await persist();
  return { token, csrfToken, expiresAt: record.expiresAt };
}

// Validates the session cookie and, on success, slides the expiry forward
// when it's getting close. Returns null for a missing/unknown/expired
// session — callers should treat that as "not logged in".
export async function touchSession(token: string): Promise<SessionRecord | null> {
  const record = sessions.get(hashToken(token));
  if (!record) return null;
  const now = Date.now();
  if (record.expiresAt <= now) {
    sessions.delete(hashToken(token));
    void persist();
    return null;
  }
  if (record.expiresAt - now < RENEW_THRESHOLD_MS) {
    record.expiresAt = now + SESSION_TTL_MS;
    void persist();
  }
  return record;
}

export async function destroySession(token: string): Promise<void> {
  if (sessions.delete(hashToken(token))) await persist();
}
