import { lookup } from 'dns/promises';
import { isIP } from 'net';

const MAX_REDIRECTS = 3;
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024; // 5 MB

export class UnsafeUrlError extends Error {}

// IPv4 ranges that must never be reachable from a server-supplied URL:
// loopback, RFC1918 private space, link-local, and CGNAT.
function isBlockedIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(n => Number.isNaN(n))) return true;
  const [a, b] = parts;
  if (a === 127) return true; // loopback
  if (a === 10) return true; // RFC1918
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
  if (a === 192 && b === 168) return true; // RFC1918
  if (a === 169 && b === 254) return true; // link-local (incl. cloud metadata)
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 0) return true; // "this network"
  if (a >= 224) return true; // multicast + reserved
  return false;
}

function isBlockedIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === '::1') return true; // loopback
  if (lower === '::') return true;
  if (lower.startsWith('fe80:') || lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) return true; // link-local
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // unique local (private)
  if (lower.startsWith('::ffff:')) {
    // IPv4-mapped IPv6 — check the embedded IPv4 address too
    const v4 = lower.slice('::ffff:'.length);
    if (isIP(v4) === 4) return isBlockedIPv4(v4);
  }
  return false;
}

function isBlockedIp(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return isBlockedIPv4(ip);
  if (kind === 6) return isBlockedIPv6(ip);
  return true; // not a recognizable IP — reject rather than guess
}

// Validates scheme + resolves the hostname, rejecting anything that points
// at loopback/private/link-local/metadata addresses. Called both when a
// calendar URL is saved (PUT /api/secrets) and again every time it's
// fetched, since DNS answers can change between the two.
export async function assertSafeUrl(rawUrl: string, opts: { allowHttp?: boolean } = {}): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new UnsafeUrlError('Not a valid URL');
  }

  if (url.protocol !== 'https:' && !(opts.allowHttp && url.protocol === 'http:')) {
    throw new UnsafeUrlError('Only https:// URLs are allowed');
  }
  if (url.username || url.password) {
    throw new UnsafeUrlError('URLs with embedded credentials are not allowed');
  }

  const hostname = url.hostname;
  const directIpKind = isIP(hostname);
  if (directIpKind) {
    if (isBlockedIp(hostname)) throw new UnsafeUrlError('URL resolves to a blocked address range');
    return url;
  }

  if (hostname === 'localhost') throw new UnsafeUrlError('URL resolves to a blocked address range');

  let addresses: { address: string }[];
  try {
    addresses = await lookup(hostname, { all: true });
  } catch {
    throw new UnsafeUrlError(`Could not resolve host "${hostname}"`);
  }
  if (addresses.length === 0) throw new UnsafeUrlError(`Could not resolve host "${hostname}"`);
  for (const { address } of addresses) {
    if (isBlockedIp(address)) throw new UnsafeUrlError('URL resolves to a blocked address range');
  }

  return url;
}

export interface SafeFetchOptions {
  timeoutMs?: number;
  maxBytes?: number;
  allowHttp?: boolean;
}

// fetch() with SSRF protection (validated at every hop), a hard timeout,
// and a response-size cap. Use this for every outbound request the server
// makes on behalf of stored or user-supplied config (calendar feeds); use
// it for hardcoded first-party API calls too (weather, holidays) so a
// slow/huge response can't hang or exhaust the process.
export async function safeFetch(rawUrl: string, options: SafeFetchOptions = {}): Promise<Response> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;

  let currentUrl = rawUrl;
  let res: Response | undefined;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const validated = await assertSafeUrl(currentUrl, { allowHttp: options.allowHttp });
    res = await fetch(validated, {
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (res.status >= 300 && res.status < 400 && res.headers.has('location')) {
      const location = new URL(res.headers.get('location')!, validated).toString();
      // Drain the (empty) redirect body before following.
      await res.body?.cancel().catch(() => {});
      currentUrl = location;
      continue;
    }
    break;
  }

  if (!res) throw new UnsafeUrlError('Too many redirects');
  if (res.status >= 300 && res.status < 400) throw new UnsafeUrlError('Too many redirects');

  return capResponseSize(res, maxBytes);
}

// Wraps a Response so .text()/.json() throw if the body exceeds maxBytes,
// instead of buffering an unbounded amount of attacker-controlled data.
function capResponseSize(res: Response, maxBytes: number): Response {
  if (!res.body) return res;
  const reader = res.body.getReader();
  let received = 0;

  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        controller.close();
        return;
      }
      received += value.byteLength;
      if (received > maxBytes) {
        controller.error(new UnsafeUrlError(`Response exceeded ${maxBytes} byte limit`));
        await reader.cancel().catch(() => {});
        return;
      }
      controller.enqueue(value);
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });

  return new Response(stream, { status: res.status, statusText: res.statusText, headers: res.headers });
}
