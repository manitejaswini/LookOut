import dns from 'node:dns';
import { isIP } from 'node:net';

/**
 * SSRF guard. The checker fetches domains chosen by strangers (reporters, feeds), so it must never be tricked
 * into talking to our own machine or network. A host is allowed only if EVERY address it resolves to is public.
 * The check runs inside the socket's own DNS lookup, so a DNS-rebinding trick (public on the first lookup,
 * private on the second) cannot slip through: the address we validate is the address we connect to.
 */

export class BlockedUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BlockedUrlError';
  }
}

/* ---------- IPv4 ---------- */

const v4ToInt = (ip: string): number => ip.split('.').reduce((n, part) => n * 256 + Number(part), 0);

// [network, prefix length]. Anything inside one of these is not a public address.
const V4_BLOCKED: [string, number][] = [
  ['0.0.0.0', 8], // "this network"
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local, includes cloud metadata at 169.254.169.254
  ['172.16.0.0', 12], // private
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // documentation
  ['192.88.99.0', 24], // 6to4 relay
  ['192.168.0.0', 16], // private
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // documentation
  ['203.0.113.0', 24], // documentation
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved, includes broadcast
];

function v4Public(ip: string): boolean {
  const n = v4ToInt(ip);
  return !V4_BLOCKED.some(([net, bits]) => {
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (n & mask) >>> 0 === (v4ToInt(net) & mask) >>> 0;
  });
}

/* ---------- IPv6 ---------- */

/** Expands any IPv6 text form into 8 groups of 16 bits. Returns null if it is not valid. */
function v6Groups(input: string): number[] | null {
  let ip = input.split('%')[0]; // drop a zone id such as fe80::1%eth0
  if (ip.includes('.')) {
    // dotted IPv4 tail, as in ::ffff:1.2.3.4
    const cut = ip.lastIndexOf(':');
    const v4 = ip.slice(cut + 1);
    if (isIP(v4) !== 4) return null;
    const [a, b, c, d] = v4.split('.').map(Number);
    ip = `${ip.slice(0, cut + 1)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = ip.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const parts = [...head, ...Array(halves.length === 2 ? missing : 0).fill('0'), ...tail];
  if (parts.length !== 8) return null;
  const groups = parts.map((p) => parseInt(p, 16));
  return groups.some((g) => Number.isNaN(g) || g < 0 || g > 0xffff) ? null : groups;
}

const embeddedV4 = (hi: number, lo: number) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;

function v6Public(ip: string): boolean {
  const g = v6Groups(ip);
  if (!g) return false; // anything we cannot parse is treated as unsafe
  const allZero = (from: number, to: number) => g.slice(from, to).every((x) => x === 0);

  if (allZero(0, 8)) return false; // ::
  if (allZero(0, 7) && g[7] === 1) return false; // ::1 loopback
  if (allZero(0, 5) && g[5] === 0xffff) return v4Public(embeddedV4(g[6], g[7])); // IPv4-mapped ::ffff:a.b.c.d
  if (allZero(0, 6)) return v4Public(embeddedV4(g[6], g[7])); // IPv4-compatible ::a.b.c.d (deprecated)
  if (g[0] === 0x64 && g[1] === 0xff9b && allZero(2, 6)) return v4Public(embeddedV4(g[6], g[7])); // NAT64 64:ff9b::/96
  if (g[0] === 0x2002) return v4Public(embeddedV4(g[1], g[2])); // 6to4 carries an IPv4 address
  if ((g[0] & 0xfe00) === 0xfc00) return false; // fc00::/7 unique local
  if ((g[0] & 0xffc0) === 0xfe80) return false; // fe80::/10 link-local
  if ((g[0] & 0xff00) === 0xff00) return false; // ff00::/8 multicast
  if (g[0] === 0x2001 && g[1] === 0x0db8) return false; // 2001:db8::/32 documentation
  if (g[0] === 0x0100 && allZero(1, 4)) return false; // 100::/64 discard
  return true;
}

/** True only for an address on the public internet. Garbage, private and special-purpose addresses are false. */
export function isPublicAddress(ip: string): boolean {
  const kind = isIP(ip.replace(/^\[|\]$/g, ''));
  const bare = ip.replace(/^\[|\]$/g, '');
  if (kind === 4) return v4Public(bare);
  if (kind === 6) return v6Public(bare);
  return false;
}

/* ---------- URLs and DNS ---------- */

/** Accepts only plain http(s) on the default ports, without credentials, and never an IP literal that is not public. */
export function validateUrl(input: string): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new BlockedUrlError(`not a valid URL: ${input}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new BlockedUrlError(`scheme not allowed: ${url.protocol}`);
  if (url.username || url.password) throw new BlockedUrlError('credentials in a URL are not allowed');
  if (url.port && url.port !== '80' && url.port !== '443') throw new BlockedUrlError(`port not allowed: ${url.port}`);
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!host) throw new BlockedUrlError('empty host');
  if (isIP(host) && !isPublicAddress(host)) throw new BlockedUrlError(`address not public: ${host}`);
  return url;
}

type LookupCallback = (err: Error | null, address?: string | dns.LookupAddress[], family?: number) => void;

/** A drop-in `lookup` for http(s).request: resolves, then refuses unless every address is public. */
export function guardedLookup(hostname: string, options: dns.LookupOptions | number, callback: LookupCallback): void {
  const opts = typeof options === 'number' ? { family: options } : options ?? {};
  dns.lookup(hostname, { ...opts, all: true }, (err, addresses) => {
    if (err) return callback(err);
    const list = addresses as dns.LookupAddress[];
    if (list.length === 0) return callback(new BlockedUrlError(`no address for ${hostname}`));
    const bad = list.find((a) => !isPublicAddress(a.address));
    if (bad) return callback(new BlockedUrlError(`${hostname} resolves to a non-public address (${bad.address})`));
    if (opts.all) return callback(null, list);
    return callback(null, list[0].address, list[0].family);
  });
}
