import http from 'node:http';
import https from 'node:https';
import type { LookupFunction } from 'node:net';
import { guardedLookup, validateUrl } from './ssrf.ts';

/** What one request told us. We never need the page itself, only where it sends the visitor. */
export interface HopResult {
  status: number;
  /** the Location header of a 3xx, as sent (may be relative) */
  location?: string;
  /** the target of an HTML `<meta http-equiv="refresh">`, if the page has one */
  metaRefresh?: string;
}

/** Fetches ONE URL without following redirects. Swappable, so redirect logic can be tested without a network. */
export type HopFetcher = (url: string) => Promise<HopResult>;

const TIMEOUT_MS = 8_000;
const MAX_BODY_BYTES = 64 * 1024;
const USER_AGENT = 'LookoutChecker/0.1 (scam check; reads redirects only)';

/** `<meta http-equiv="refresh" content="0; url=https://example.com/x">` */
export function parseMetaRefresh(html: string): string | undefined {
  const tag = html.match(/<meta[^>]+http-equiv\s*=\s*["']?refresh["']?[^>]*>/i)?.[0];
  if (!tag) return undefined;
  // the value ends at the SAME quote character that opened it, so inner quotes (content='3;URL="x"') survive
  const content = tag.match(new RegExp('content\\s*=\\s*(["\'])(.*?)\\1', 'i'))?.[2];
  return content?.match(/url\s*=\s*['"]?\s*([^'";\s]+)/i)?.[1];
}

/**
 * The real fetcher. Every connection goes through the SSRF-guarded DNS lookup, only plain http(s) on the default
 * ports is allowed, the request has a hard timeout, and at most 64 KiB of any page is read. It does not run scripts,
 * so a JavaScript redirect is invisible to it (a known limit, recorded in the evidence).
 */
export const fetchHop: HopFetcher = (input) =>
  new Promise((resolve, reject) => {
    let url: URL;
    try {
      url = validateUrl(input);
    } catch (e) {
      return reject(e);
    }
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.request(
      {
        hostname: url.hostname.replace(/^\[|\]$/g, ''),
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method: 'GET',
        headers: { 'user-agent': USER_AGENT, accept: 'text/html,*/*;q=0.5', 'accept-encoding': 'identity' },
        lookup: guardedLookup as unknown as LookupFunction,
        agent: false,
        timeout: TIMEOUT_MS,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const location = typeof res.headers.location === 'string' ? res.headers.location : undefined;
        const isHtml = String(res.headers['content-type'] ?? '').toLowerCase().includes('text/html');
        if (status >= 300 && status < 400) {
          res.destroy();
          return resolve({ status, location });
        }
        if (!isHtml || status >= 400) {
          res.destroy();
          return resolve({ status });
        }
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          body += chunk;
          if (body.length >= MAX_BODY_BYTES) res.destroy();
        });
        const done = () => resolve({ status, metaRefresh: parseMetaRefresh(body) });
        res.on('end', done);
        res.on('close', done);
        res.on('error', done);
      },
    );
    req.on('timeout', () => req.destroy(new Error(`timeout after ${TIMEOUT_MS} ms`)));
    req.on('error', reject);
    req.end();
  });
