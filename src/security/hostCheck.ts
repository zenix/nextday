import { networkInterfaces } from 'os';
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getPublicConfig } from '../config/store.js';

// Defeats DNS rebinding: a page you visit in a browser on this LAN could
// point a hostname it controls at this server's LAN IP, and — because the
// session cookie is sent automatically — drive the API as you. Requests
// whose Host header isn't one of this machine's own addresses (or an
// address the operator explicitly allow-listed) are rejected before auth
// or routing ever sees them.
let allowedHosts = new Set<string>(['localhost', '127.0.0.1', '::1']);

function collectInterfaceAddresses(): string[] {
  const addrs: string[] = [];
  for (const ifaces of Object.values(networkInterfaces())) {
    for (const iface of ifaces ?? []) {
      if (!iface.internal) addrs.push(iface.address);
    }
  }
  return addrs;
}

export async function refreshAllowedHosts(): Promise<void> {
  const config = await getPublicConfig();
  const set = new Set<string>(['localhost', '127.0.0.1', '::1']);
  for (const addr of collectInterfaceAddresses()) set.add(addr.toLowerCase());
  for (const host of config.allowedHosts ?? []) set.add(host.toLowerCase());
  allowedHosts = set;
}

export function extractHostname(hostHeader: string | undefined): string | null {
  if (!hostHeader) return null;
  const bracketMatch = hostHeader.match(/^\[([^\]]+)\](?::\d+)?$/); // IPv6: "[::1]:3000"
  if (bracketMatch) return bracketMatch[1].toLowerCase();
  const idx = hostHeader.lastIndexOf(':');
  const hostname = idx === -1 ? hostHeader : hostHeader.slice(0, idx);
  return hostname.toLowerCase();
}

export function registerHostCheck(app: FastifyInstance): void {
  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    const hostname = extractHostname(request.headers.host);
    if (!hostname || !allowedHosts.has(hostname)) {
      reply.code(400).send({ error: 'Invalid Host header' });
    }
  });
}
