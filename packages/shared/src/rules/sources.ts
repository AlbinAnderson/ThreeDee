/**
 * Per-room allowed books (Epic 11): matching .pcg CAMPAIGN lines to rules
 * pack books and warning about characters built with books the campaign
 * doesn't allow (or the pack doesn't have).
 */
import type { Character } from '../entities/pf1e';
import type { RulesBook } from './types';

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Old-style PCGen campaign names prefix the publisher and game line. */
const PREFIXES = ['paizopathfinderroleplayinggame', 'paizopathfinderrpg', 'paizopathfinder', 'paizo', 'pathfinderroleplayinggame', 'pathfinderrpg', 'pathfinder'];

/**
 * The pack book a .pcg CAMPAIGN line refers to. PCGen 6 writes the .pcc KEY
 * ("Core Rulebook"); older files write "Paizo - Pathfinder Roleplaying Game
 * Core Rulebook". Exact key/name matches win, then the
 * same name after the publisher prefix (so "... Bestiary 2" never matches "Bestiary").
 */
export function matchCampaign(campaign: string, books: readonly Pick<RulesBook, 'key' | 'name'>[]): Pick<RulesBook, 'key' | 'name'> | undefined {
  const n = norm(campaign);
  if (!n) return undefined;
  const exact = books.find((b) => norm(b.key) === n || norm(b.name) === n);
  if (exact) return exact;
  const stripped = PREFIXES.reduce((acc, p) => (acc.startsWith(p) && acc.length > p.length ? acc.slice(p.length) : acc), n);
  return books.find((b) => norm(b.key) === stripped || norm(b.name) === stripped);
}

export const isSourceAllowed = (allowed: readonly string[] | null, campaign: string) => allowed === null || allowed.includes(campaign);

export interface SourceWarning {
  /** The .pcg CAMPAIGN line. */
  campaign: string;
  /** Matching pack book key, if any. */
  book: string | null;
  reason: 'notAllowed' | 'missing';
}

/** Books a character uses that the room doesn't allow, or that the rules pack doesn't have. */
export function checkCampaigns(campaigns: readonly string[], books: readonly Pick<RulesBook, 'key' | 'name'>[], allowed: readonly string[] | null): SourceWarning[] {
  if (books.length === 0) return [];
  const out: SourceWarning[] = [];
  const seen = new Set<string>();
  for (const raw of campaigns) {
    const campaign = raw.trim();
    if (!campaign || seen.has(campaign)) continue;
    seen.add(campaign);
    const book = matchCampaign(campaign, books);
    if (!book) out.push({ campaign, book: null, reason: 'missing' });
    else if (!isSourceAllowed(allowed, book.key)) out.push({ campaign, book: book.key, reason: 'notAllowed' });
  }
  return out;
}

export function describeSourceWarning(w: SourceWarning): string {
  return w.reason === 'missing' ? `"${w.campaign}" isn't in the server's rules pack` : `"${w.campaign}" isn't an allowed book in this campaign`;
}

/** Pack book keys for every CAMPAIGN line of the party's .pcg files (the "Match party books" helper). */
export function partySourceKeys(characters: Iterable<Pick<Character, 'build'>>, books: readonly Pick<RulesBook, 'key' | 'name'>[]): string[] {
  const keys = new Set<string>();
  for (const c of characters) {
    for (const campaign of c.build.system.campaigns) {
      const b = matchCampaign(campaign, books);
      if (b) keys.add(b.key);
    }
  }
  return [...keys].sort();
}
