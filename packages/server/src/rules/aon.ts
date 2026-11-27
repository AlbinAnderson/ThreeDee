/**
 * On-demand, cached, rate-limited Archives of Nethys (aonprd.com) single-page
 * fetcher (Epic 11, #58 & #59).
 *
 * Security & etiquette guarantees:
 *  - Only fetches allowlisted `https://www.aonprd.com/<Type>Display.aspx?ItemName=...` URLs.
 *  - Redirects are handled manually and every redirect target is re-validated against the allowlist.
 *  - Hard caps on timeout (10 s) and response body size (1 MiB).
 *  - Rate-limited (min interval + per-minute cap) on live upstream requests; disk cache hits are free.
 *  - Accepts an injectable `fetchFn` so all automated tests stay 100% offline.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  aonPageKind,
  aonUrl,
  normalizeAonUrl,
  parseAonMonsterHtml,
  parseAonPage,
  type AonFetchResult,
  type AonKind,
} from '@vtt/shared';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface AonFetcherOptions {
  cacheDir: string;
  fetchFn?: FetchLike;
  minIntervalMs?: number;
  maxPerMinute?: number;
  timeoutMs?: number;
  maxBytes?: number;
  now?: () => number;
}

const MAX_REDIRECTS = 2;

export class AonFetcher {
  private readonly cacheDir: string;
  private readonly fetchFn: FetchLike;
  private readonly minIntervalMs: number;
  private readonly maxPerMinute: number;
  private readonly timeoutMs: number;
  private readonly maxBytes: number;
  private readonly now: () => number;
  private recentLive: number[] = [];

  constructor(opts: AonFetcherOptions) {
    this.cacheDir = opts.cacheDir;
    this.fetchFn = opts.fetchFn ?? ((url, init) => globalThis.fetch(url, init));
    this.minIntervalMs = opts.minIntervalMs ?? 1500;
    this.maxPerMinute = opts.maxPerMinute ?? 8;
    this.timeoutMs = opts.timeoutMs ?? 10_000;
    this.maxBytes = opts.maxBytes ?? 1_048_576;
    this.now = opts.now ?? Date.now;
  }

  private cachePath(url: string): string {
    const hash = crypto.createHash('sha256').update(url).digest('hex').slice(0, 32);
    return path.join(this.cacheDir, `${hash}.html`);
  }

  private checkRateLimit() {
    const t = this.now();
    this.recentLive = this.recentLive.filter((ts) => t - ts < 60_000);
    const last = this.recentLive[this.recentLive.length - 1];
    if (last !== undefined && t - last < this.minIntervalMs) {
      throw new Error('Please wait a moment between Archives of Nethys lookups');
    }
    if (this.recentLive.length >= this.maxPerMinute) {
      throw new Error('Archives of Nethys rate limit reached (try again in a minute)');
    }
    this.recentLive.push(t);
  }

  /** Fetch one allowlisted AoN page (checking redirects, size and rate limit). */
  private async fetchHtml(url: string): Promise<{ html: string; finalUrl: string; cached: boolean }> {
    const cp = this.cachePath(url);
    if (fs.existsSync(cp)) {
      return { html: fs.readFileSync(cp, 'utf8'), finalUrl: url, cached: true };
    }

    this.checkRateLimit();
    let current = url;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      let res: Response;
      try {
        res = await this.fetchFn(current, {
          method: 'GET',
          redirect: 'manual',
          signal: controller.signal,
          headers: { 'User-Agent': 'pf1eSimplifier-VTT/1.0 (single-page lookup; not a crawler)' },
        });
      } finally {
        clearTimeout(timer);
      }

      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('location');
        if (!loc) throw new Error('Archives of Nethys returned an empty redirect');
        const resolved = new URL(loc, current).toString();
        const safe = normalizeAonUrl(resolved);
        if (!safe) throw new Error('Blocked redirect outside Archives of Nethys');
        current = safe;
        continue;
      }

      if (!res.ok) throw new Error(`Archives of Nethys returned HTTP ${res.status}`);

      const buf = await res.arrayBuffer();
      if (buf.byteLength > this.maxBytes) throw new Error('Archives of Nethys page exceeded maximum size');
      const html = new TextDecoder('utf-8').decode(buf);
      fs.mkdirSync(this.cacheDir, { recursive: true });
      fs.writeFileSync(cp, html, 'utf8');
      return { html, finalUrl: current, cached: false };
    }
    throw new Error('Too many redirects from Archives of Nethys');
  }

  /** Resolve a URL or `(kind, name)`, fetch/read from cache, and parse into a draft. */
  async lookup(input: { url?: string; kind?: Exclude<AonKind, 'search'>; name?: string }): Promise<AonFetchResult> {
    let rawUrl: string;
    if (input.url) {
      rawUrl = input.url;
    } else if (input.kind && input.name) {
      rawUrl = aonUrl(input.kind, input.name);
    } else {
      throw new Error('Provide an Archives of Nethys URL or a type and name');
    }

    const safeUrl = normalizeAonUrl(rawUrl);
    if (!safeUrl) {
      throw new Error('Only https://www.aonprd.com/<Type>Display.aspx?ItemName=... URLs are allowed');
    }

    const { html, finalUrl, cached } = await this.fetchHtml(safeUrl);
    const pageKind = aonPageKind(finalUrl);
    if (pageKind === 'monster') {
      return { url: finalUrl, cached, pageKind, draft: null, monster: parseAonMonsterHtml(html, finalUrl) };
    }
    if (pageKind === 'spell' || pageKind === 'feat' || pageKind === 'item') {
      return { url: finalUrl, cached, pageKind, draft: parseAonPage(html, finalUrl), monster: null };
    }
    throw new Error('Unsupported Archives of Nethys page type');
  }
}
