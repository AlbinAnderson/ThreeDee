/**
 * PF1e companions (Epic 9): familiars, animal companions, mounts, eidolons,
 * phantoms and cohorts linked to a master character. Pure helpers shared by
 * the actions, the UI and the tests.
 *
 * Rules sources (local PCGen data):
 *  - Animal Companion ~ Link (cr_abilities_companion.lst): handle as a free
 *    action, push as a move action, even without ranks; +4 circumstance bonus
 *    on Handle Animal checks regarding the animal companion.
 *  - Animal Trick ~ * (cr_abilities_companion.lst): the core trick list.
 *  - Summoner ~ Life Link (apg_abilities_class.lst): free action, each hit point
 *    sacrificed prevents 1 point of damage to the eidolon.
 *  - Spiritualist ~ Etheric Tether (oa_abilities_class.lst): same 1-for-1
 *    sacrifice for a manifested phantom, without using an action.
 * Handle Animal DCs (handle 10, push 25, +2 if wounded) and the normal action
 * costs (handle = move, push = full-round) are from the Core Rulebook skill
 * prose, which isn't in the .lst files.
 */
import type { Character, CompanionType } from '../entities/pf1e';
import type { PcgenCharacter } from '../pcgen/schema';
import type { GameState, Scene, Token } from '../state';
import type { ActionCost } from './actions';
import { computeCharacterStats } from './engine';
import { normalizeName } from './rules';
import { computeSkills } from './skills';
import { characterHp } from './tokenSync';

export const COMPANION_TYPES: CompanionType[] = ['familiar', 'animalCompanion', 'mount', 'eidolon', 'phantom', 'cohort', 'other'];

export const COMPANION_TYPE_LABEL: Record<CompanionType, string> = {
  familiar: 'Familiar',
  animalCompanion: 'Animal companion',
  mount: 'Mount',
  eidolon: 'Eidolon',
  phantom: 'Phantom',
  cohort: 'Cohort',
  other: 'Companion',
};

/** What harboring is called for each kind of companion. */
export const HARBOR_LABEL: Record<CompanionType, string> = {
  familiar: 'Stowed',
  animalCompanion: 'Away',
  mount: 'Stabled',
  eidolon: 'Dismissed',
  phantom: 'Harbored',
  cohort: 'Away',
  other: 'Away',
};

/** PCGen follower TYPEs (without the level suffix, e.g. "Animal Companion 7"), normalized. */
const PCGEN_TYPES: Record<string, CompanionType> = {
  animalcompanion: 'animalCompanion',
  plantcompanion: 'animalCompanion',
  familiar: 'familiar',
  eidolon: 'eidolon',
  unchainedeidolon: 'eidolon',
  phantom: 'phantom',
  undeadphantom: 'phantom',
  mount: 'mount',
  specialmount: 'mount',
  cavaliermount: 'mount',
  samuraimount: 'mount',
  ghostmount: 'mount',
  cohort: 'cohort',
  follower: 'cohort',
};

/** Companion type for a PCGen MASTER/FOLLOWER TYPE ("Animal Companion 7", "Familiar", "Cavalier Mount"). */
export function companionTypeFromPcgen(type: string | null | undefined): CompanionType {
  if (!type) return 'other';
  const key = normalizeName(type.trim().replace(/\s+\d+$/, ''));
  return PCGEN_TYPES[key] ?? 'other';
}

/** Companions whose master has the Link class feature by default. */
export const defaultLink = (type: CompanionType) => type === 'animalCompanion' || type === 'mount';

/** Kinds of companion Handle Animal applies to. */
export const canBeHandled = (type: CompanionType) => type === 'animalCompanion' || type === 'mount' || type === 'other';

/** Life Link (eidolon) and Etheric Tether (phantom): the master sacrifices HP for the companion. */
export function hpLinkName(type: CompanionType): string | null {
  if (type === 'eidolon') return 'Life Link';
  if (type === 'phantom') return 'Etheric Tether';
  return null;
}

/** Core Rulebook tricks (Animal Trick ~ * in cr_abilities_companion.lst). */
export const STANDARD_TRICKS = ['Attack', 'Attack II', 'Come', 'Defend', 'Down', 'Fetch', 'Guard', 'Heel', 'Perform', 'Seek', 'Stay', 'Track', 'Work'] as const;

/** A trick name with the standard spelling if it is a core trick. */
export function canonicalTrick(raw: string): string {
  const name = raw.trim().replace(/\s+/g, ' ').slice(0, 40);
  const key = normalizeName(name);
  return STANDARD_TRICKS.find((t) => normalizeName(t) === key) ?? name;
}

/** Tricks recorded in a companion's .pcg (`Animal Trick ~ Heel` abilities). */
export function tricksFromBuild(build: PcgenCharacter): string[] {
  const out: string[] = [];
  for (const a of build.abilities) {
    const m = /^animal trick\s*~\s*(.+)$/i.exec(a.key.trim());
    if (!m) continue;
    const t = canonicalTrick(m[1]!);
    if (t && !out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t);
  }
  return out.slice(0, 40);
}

// ------------------------------------------------------------------ links

export const masterOf = (state: Pick<GameState, 'characters'>, c: Character) => (c.companion ? state.characters[c.companion.masterId] : undefined);

export function companionsOf(state: Pick<GameState, 'characters'>, masterId: string): Character[] {
  return Object.values(state.characters)
    .filter((c) => c.companion?.masterId === masterId)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Why `companionId` can't become a companion of `masterId`, or true. Checks
 * self-links and cycles (A → B → A, or longer) through the master chain.
 */
export function companionLinkProblem(state: Pick<GameState, 'characters'>, companionId: string, masterId: string): true | string {
  if (companionId === masterId) return 'A character can’t be its own companion';
  const companion = state.characters[companionId];
  const master = state.characters[masterId];
  if (!companion || !master) return 'Character not found';
  const seen = new Set<string>();
  let cur: Character | undefined = master;
  while (cur?.companion) {
    if (cur.companion.masterId === companionId) return `${master.name} is already ${companion.name}’s companion`;
    if (seen.has(cur.id)) break;
    seen.add(cur.id);
    cur = state.characters[cur.companion.masterId];
  }
  return true;
}

// ------------------------------------------------------------------ hit points

export interface HpView {
  current: number;
  temp: number;
  nonlethal: number;
  max: number;
  /** Linked token holding the live HP, if any. */
  tokenId: string | null;
}

/** Live HP and max, from the linked token if there is one. */
export function hpView(state: Pick<GameState, 'tokens'>, c: Character): HpView {
  const token = c.tokenId ? state.tokens[c.tokenId] : undefined;
  const statsMax = Math.min(100000, Math.max(1, computeCharacterStats(c).hp.total));
  const max = token?.hp ? token.hp.max : statsMax;
  const hp = characterHp(state, c, statsMax);
  return { current: hp.current, temp: hp.temp, nonlethal: hp.nonlethal, max, tokenId: token?.hp ? token.id : null };
}

/** Wounded for Handle Animal: below max HP, or any nonlethal or ability damage. */
export function isWounded(state: Pick<GameState, 'tokens'>, c: Character): boolean {
  const hp = hpView(state, c);
  return hp.current < hp.max || hp.nonlethal > 0 || Object.values(c.runtime.abilityDamage).some((v) => (v ?? 0) > 0);
}

// ------------------------------------------------------------------ Handle Animal

export type HandleMode = 'handle' | 'push';

export interface HandleAnimalCheck {
  dc: number;
  cost: ActionCost;
  /** +4 circumstance with Link. */
  linkBonus: number;
  /** Master's Handle Animal total (before the Link bonus). */
  skill: number;
  /** Total bonus to roll. */
  bonus: number;
  wounded: boolean;
  trained: boolean;
}

export const HANDLE_DC = { handle: 10, push: 25 } as const;

/** DC, action cost and bonus for the master handling or pushing a companion. */
export function handleAnimalCheck(state: Pick<GameState, 'tokens'>, master: Character, companion: Character, mode: HandleMode): HandleAnimalCheck {
  const link = !!companion.companion?.link;
  const wounded = isWounded(state, companion);
  const dc = HANDLE_DC[mode] + (wounded ? 2 : 0);
  const cost: ActionCost = mode === 'handle' ? (link ? 'free' : 'move') : link ? 'move' : 'fullRound';
  const row = computeSkills(master, computeCharacterStats(master)).rows.find((r) => r.name === 'Handle Animal');
  const skill = row?.total.total ?? 0;
  const linkBonus = link ? 4 : 0;
  return { dc, cost, linkBonus, skill, bonus: Math.max(-100, Math.min(200, skill + linkBonus)), wounded, trained: (row?.ranks ?? 0) > 0 };
}

// ------------------------------------------------------------------ placement

/** Top-left position for a token of `size` cells next to `anchor`, inside the scene. */
export function adjacentPosition(scene: Scene, anchor: Pick<Token, 'x' | 'y' | 'size'>, size: number): { x: number; y: number } {
  const cell = scene.grid.size;
  const w = size * cell;
  const clamp = (v: number, max: number) => Math.max(0, Math.min(Math.max(0, max), v));
  // Prefer the right of the anchor; fall back to the left when that runs off the scene.
  let x = anchor.x + anchor.size * cell;
  if (x + w > scene.width) x = anchor.x - w;
  return { x: clamp(x, scene.width - w), y: clamp(anchor.y, scene.height - w) };
}

/** Keep a stored position inside the scene. */
export function clampToScene(scene: Scene, x: number, y: number, size: number): { x: number; y: number } {
  const w = size * scene.grid.size;
  return { x: Math.max(0, Math.min(Math.max(0, scene.width - w), x)), y: Math.max(0, Math.min(Math.max(0, scene.height - w), y)) };
}
