/**
 * In-memory rules pack store loaded from `DATA_DIR/rules/` (Epic 11).
 *
 * Implements `RulesProvider` for action `prepare()` (exact gear on import,
 * shopping prices, spell cards) plus fast search and GM treasure rolling.
 * Degrades gracefully when no rules pack has been built yet.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  baseCost,
  isSourceAllowed,
  matchesTreasureType,
  normalizeName,
  RULES_KINDS,
  spellSchoolLine,
  TREASURE_BANDS,
  treasureFromRecord,
  type CustomRule,
  type EquipmentRecord,
  type FeatRecord,
  type RecordOf,
  type RulesBook,
  type RulesHit,
  type RulesKind,
  type RulesManifest,
  type RulesProvider,
  type RulesRecord,
  type RulesStatus,
  type SpellRecord,
  type TreasureBand,
  type TreasureLoot,
  type TreasureType,
} from '@vtt/shared';

function nameVariants(raw: string): string[] {
  const s = raw.trim();
  const out = [normalizeName(s)];
  // "Invisibility, Greater" <-> "Invisibility (Greater)"
  const paren = /^(.+?)\s*\(([^()]+)\)$/.exec(s);
  if (paren) out.push(normalizeName(`${paren[1]} ${paren[2]}`), normalizeName(`${paren[2]} ${paren[1]}`));
  const comma = /^([^,]+),\s*(.+)$/.exec(s);
  if (comma) out.push(normalizeName(`${comma[1]} ${comma[2]}`), normalizeName(`${comma[2]} ${comma[1]}`));
  const tilde = s.lastIndexOf('~');
  if (tilde !== -1) out.push(normalizeName(s.slice(tilde + 1)));
  return [...new Set(out.filter(Boolean))];
}

function hitSummary(rec: RulesRecord): string {
  switch (rec.kind) {
    case 'equipment': {
      const c = baseCost(rec);
      const parts = [c !== null ? `${c.toLocaleString('en-US')} gp` : null, rec.slot && rec.slot !== 'none' ? rec.slot : null, rec.damage, rec.acBonus !== null ? `AC +${rec.acBonus}` : null];
      return parts.filter(Boolean).join(' · ');
    }
    case 'spell': {
      const lvls = Object.entries(rec.classes)
        .slice(0, 3)
        .map(([k, v]) => `${k} ${v}`)
        .join(', ');
      return [spellSchoolLine(rec), lvls].filter(Boolean).join(' · ');
    }
    case 'feat':
    case 'ability':
      return [(rec as FeatRecord).category, rec.types.slice(0, 3).join(', ')].filter(Boolean).join(' · ');
    case 'deity':
      return [rec.alignment, rec.favoredWeapon].filter(Boolean).join(' · ');
    case 'equipmod':
      return rec.cost ? `Cost ${rec.cost}` : rec.itypes.slice(0, 3).join(', ');
    case 'domain':
      return rec.desc.slice(0, 80);
    case 'class': {
      const babLabel = rec.bab === 'full' ? 'Full BAB' : rec.bab === 'threeQuarter' ? '¾ BAB' : rec.bab === 'half' ? '½ BAB' : null;
      const saves = rec.goodSaves.length ? `Good: ${rec.goodSaves.map((s) => s[0]!.toUpperCase() + s.slice(1)).join(', ')}` : null;
      return [rec.hd ? `d${rec.hd}` : null, babLabel, saves, rec.prestige ? 'Prestige' : null].filter(Boolean).join(' · ');
    }
    case 'race': {
      const mods = Object.entries(rec.abilityMods)
        .map(([k, v]) => `${v! >= 0 ? '+' : ''}${v} ${k}`)
        .join(', ');
      return [rec.size, rec.speed !== null ? `${rec.speed} ft` : null, rec.anyPlusTwo ? '+2 Any' : mods || null].filter(Boolean).join(' · ');
    }
  }
}

/** Curated fallback magic items used for GM treasure rolling when no PCGen pack is built yet. */
const FALLBACK_TREASURE: EquipmentRecord[] = [
  { kind: 'equipment', key: 'Potion of Cure Light Wounds', name: 'Potion of Cure Light Wounds', source: { campaign: 'Core Rulebook', long: 'Core Rulebook', short: 'CR', page: 'p.478' }, desc: 'Cures 1d8+1 hit points of damage.', types: ['Magic', 'Potion', 'Consumable'], cost: 50, weight: 0, baseItem: null, damage: null, critRange: null, critMult: null, range: null, wield: null, acBonus: null, maxDex: null, acp: null, asf: null, slot: 'none', cl: 1, aura: 'faint conjuration', eqmods: [], spellEffect: { name: 'Cure Light Wounds', level: 1, cl: 1 } },
  { kind: 'equipment', key: 'Wand of Cure Light Wounds', name: 'Wand of Cure Light Wounds', source: { campaign: 'Core Rulebook', long: 'Core Rulebook', short: 'CR', page: 'p.496' }, desc: '50 charges of Cure Light Wounds (1d8+1 hp).', types: ['Magic', 'Wand'], cost: 750, weight: 0, baseItem: null, damage: null, critRange: null, critMult: null, range: null, wield: null, acBonus: null, maxDex: null, acp: null, asf: null, slot: 'none', cl: 1, aura: 'faint conjuration', eqmods: [], spellEffect: { name: 'Cure Light Wounds', level: 1, cl: 1 } },
  { kind: 'equipment', key: 'Cloak of Resistance +1', name: 'Cloak of Resistance +1', source: { campaign: 'Core Rulebook', long: 'Core Rulebook', short: 'CR', page: 'p.506' }, desc: 'Grants a +1 resistance bonus on all saving throws.', types: ['Magic', 'Wondrous'], cost: 1000, weight: 1, baseItem: null, damage: null, critRange: null, critMult: null, range: null, wield: null, acBonus: null, maxDex: null, acp: null, asf: null, slot: 'shoulders', cl: 5, aura: 'faint abjuration', eqmods: [], spellEffect: null, bonuses: [{ target: 'saves', value: 1, type: 'resistance' }] },
  { kind: 'equipment', key: 'Ring of Protection +1', name: 'Ring of Protection +1', source: { campaign: 'Core Rulebook', long: 'Core Rulebook', short: 'CR', page: 'p.483' }, desc: 'Grants a +1 deflection bonus to AC.', types: ['Magic', 'Ring'], cost: 2000, weight: 0, baseItem: null, damage: null, critRange: null, critMult: null, range: null, wield: null, acBonus: null, maxDex: null, acp: null, asf: null, slot: 'ring', cl: 5, aura: 'faint abjuration', eqmods: [], spellEffect: null, bonuses: [{ target: 'ac', value: 1, type: 'deflection' }] },
  { kind: 'equipment', key: 'Amulet of Natural Armor +1', name: 'Amulet of Natural Armor +1', source: { campaign: 'Core Rulebook', long: 'Core Rulebook', short: 'CR', page: 'p.498' }, desc: 'Grants a +1 enhancement bonus to natural armor.', types: ['Magic', 'Wondrous'], cost: 2000, weight: 0, baseItem: null, damage: null, critRange: null, critMult: null, range: null, wield: null, acBonus: null, maxDex: null, acp: null, asf: null, slot: 'neck', cl: 5, aura: 'faint transmutation', eqmods: [], spellEffect: null, bonuses: [{ target: 'ac', value: 1, type: 'enhancement' }] },
  { kind: 'equipment', key: 'Bag of Holding (Type I)', name: 'Bag of Holding (Type I)', source: { campaign: 'Core Rulebook', long: 'Core Rulebook', short: 'CR', page: 'p.500' }, desc: 'Extradimensional space holding up to 250 lbs.', types: ['Magic', 'Wondrous', 'Container'], cost: 2500, weight: 15, baseItem: null, damage: null, critRange: null, critMult: null, range: null, wield: null, acBonus: null, maxDex: null, acp: null, asf: null, slot: 'none', cl: 9, aura: 'moderate conjuration', eqmods: [], spellEffect: null },
  { kind: 'equipment', key: 'Belt of Giant Strength +2', name: 'Belt of Giant Strength +2', source: { campaign: 'Core Rulebook', long: 'Core Rulebook', short: 'CR', page: 'p.501' }, desc: 'Grants a +2 enhancement bonus to Strength.', types: ['Magic', 'Wondrous'], cost: 4000, weight: 1, baseItem: null, damage: null, critRange: null, critMult: null, range: null, wield: null, acBonus: null, maxDex: null, acp: null, asf: null, slot: 'belt', cl: 8, aura: 'moderate transmutation', eqmods: [], spellEffect: null, bonuses: [{ target: 'STR', value: 2, type: 'enhancement' }] },
  { kind: 'equipment', key: 'Headband of Vast Intelligence +2', name: 'Headband of Vast Intelligence +2', source: { campaign: 'Core Rulebook', long: 'Core Rulebook', short: 'CR', page: 'p.518' }, desc: 'Grants a +2 enhancement bonus to Intelligence.', types: ['Magic', 'Wondrous'], cost: 4000, weight: 1, baseItem: null, damage: null, critRange: null, critMult: null, range: null, wield: null, acBonus: null, maxDex: null, acp: null, asf: null, slot: 'headband', cl: 8, aura: 'moderate transmutation', eqmods: [], spellEffect: null, bonuses: [{ target: 'INT', value: 2, type: 'enhancement' }] },
  { kind: 'equipment', key: 'Boots of Speed', name: 'Boots of Speed', source: { campaign: 'Core Rulebook', long: 'Core Rulebook', short: 'CR', page: 'p.503' }, desc: 'Click heels as a free action to act as though hasted for up to 10 rounds/day.', types: ['Magic', 'Wondrous'], cost: 12000, weight: 1, baseItem: null, damage: null, critRange: null, critMult: null, range: null, wield: null, acBonus: null, maxDex: null, acp: null, asf: null, slot: 'feet', cl: 10, aura: 'moderate transmutation', eqmods: [], spellEffect: null },
];

interface SearchEntry {
  rec: RulesRecord;
  lowerName: string;
  hay: string;
  canonicalBonus: number;
  campaign: string;
}

export class RulesPackStore implements RulesProvider {
  private manifest: RulesManifest | null = null;
  private byKey = Object.fromEntries(RULES_KINDS.map((k) => [k, new Map<string, RulesRecord>()])) as Record<RulesKind, Map<string, RulesRecord>>;
  private byNorm = Object.fromEntries(RULES_KINDS.map((k) => [k, new Map<string, RulesRecord>()])) as Record<RulesKind, Map<string, RulesRecord>>;
  private lists = Object.fromEntries(RULES_KINDS.map((k) => [k, [] as RulesRecord[]])) as Record<RulesKind, RulesRecord[]>;
  /** Pre-filtered, pre-lowercased, pre-sorted search index per kind (omits hidden and PCGen Internal abilities). */
  private searchable = Object.fromEntries(RULES_KINDS.map((k) => [k, [] as SearchEntry[]])) as Record<RulesKind, SearchEntry[]>;
  /** All searchable entries across default kinds, pre-sorted by (canonicalBonus desc, lowerName asc) for O(limit) empty queries. */
  private searchableAll: SearchEntry[] = [];

  constructor(private readonly dir: string) {
    this.reload();
  }

  /** Reload from disk (called at startup or after rebuilding the pack). */
  reload(): boolean {
    const manifestPath = path.join(this.dir, 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
      this.manifest = null;
      return false;
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as RulesManifest;
      if (parsed.format !== 'vtt-rules-pack') return false;
      const nextByKey = Object.fromEntries(RULES_KINDS.map((k) => [k, new Map<string, RulesRecord>()])) as Record<RulesKind, Map<string, RulesRecord>>;
      const nextByNorm = Object.fromEntries(RULES_KINDS.map((k) => [k, new Map<string, RulesRecord>()])) as Record<RulesKind, Map<string, RulesRecord>>;
      const nextLists = Object.fromEntries(RULES_KINDS.map((k) => [k, [] as RulesRecord[]])) as Record<RulesKind, RulesRecord[]>;
      const nextSearchable = Object.fromEntries(RULES_KINDS.map((k) => [k, [] as SearchEntry[]])) as Record<RulesKind, SearchEntry[]>;

      const cmpEntry = (a: SearchEntry, b: SearchEntry) =>
        b.canonicalBonus - a.canonicalBonus || (a.lowerName < b.lowerName ? -1 : a.lowerName > b.lowerName ? 1 : 0);

      for (const k of RULES_KINDS) {
        const p = path.join(this.dir, `${k}.json`);
        if (!fs.existsSync(p)) continue;
        const arr = JSON.parse(fs.readFileSync(p, 'utf8')) as RulesRecord[];
        nextLists[k] = arr;
        const searchArr: SearchEntry[] = [];
        const byNormScore = new Map<string, number>();
        const recordNormScore = (rec: RulesRecord) =>
          (rec.key === rec.name ? 4 : 0) + (rec.source.campaign === 'Core Rulebook' ? 2 : 0) + (rec.hidden ? 0 : 1);
        for (const rec of arr) {
          nextByKey[k].set(rec.key, rec);
          const isInternal = rec.kind === 'ability' && (rec as FeatRecord).category.toLowerCase() === 'internal';
          if (!isInternal) {
            const sc = recordNormScore(rec);
            for (const v of nameVariants(rec.name)) {
              if (!nextByNorm[k].has(v) || sc > (byNormScore.get(v) ?? -1)) {
                nextByNorm[k].set(v, rec);
                byNormScore.set(v, sc);
              }
            }
            for (const v of nameVariants(rec.key)) {
              if (!nextByNorm[k].has(v) || sc > (byNormScore.get(v) ?? -1)) {
                nextByNorm[k].set(v, rec);
                byNormScore.set(v, sc);
              }
            }
          }
          if (!rec.hidden && !isInternal) {
            const lowerName = rec.name.toLowerCase();
            const lowerKey = rec.key.toLowerCase();
            const lowerTypes = rec.types.length ? rec.types.join(' ').toLowerCase() : '';
            searchArr.push({
              rec,
              lowerName,
              hay: lowerKey === lowerName ? (lowerTypes ? `${lowerName} ${lowerTypes}` : lowerName) : `${lowerName} ${lowerKey}${lowerTypes ? ` ${lowerTypes}` : ''}`,
              canonicalBonus: rec.key === rec.name ? 0.5 : 0,
              campaign: rec.source.campaign,
            });
          }
        }
        searchArr.sort(cmpEntry);
        nextSearchable[k] = searchArr;
      }
      const defaultKinds: RulesKind[] = ['equipment', 'spell', 'feat', 'ability', 'class', 'race', 'deity', 'domain'];
      const nextAll = defaultKinds.flatMap((k) => nextSearchable[k]);
      nextAll.sort(cmpEntry);

      this.manifest = parsed;
      this.byKey = nextByKey;
      this.byNorm = nextByNorm;
      this.lists = nextLists;
      this.searchable = nextSearchable;
      this.searchableAll = nextAll;
      return true;
    } catch (e) {
      console.error('[rules] failed to load rules pack:', e);
      return false;
    }
  }

  get loaded(): boolean {
    return this.manifest !== null;
  }

  status(): RulesStatus {
    return {
      loaded: this.manifest !== null,
      builtAt: this.manifest?.builtAt ?? null,
      counts: this.manifest?.counts ?? {},
      books: this.manifest?.books.length ?? 0,
    };
  }

  books(): RulesBook[] {
    return this.manifest?.books ?? [];
  }

  get<K extends RulesKind>(kind: K, key: string): RecordOf<K> | undefined {
    return this.byKey[kind].get(key) as RecordOf<K> | undefined;
  }

  byName<K extends RulesKind>(kind: K, name: string): RecordOf<K> | undefined {
    const direct = this.byKey[kind].get(name);
    if (direct) return direct as RecordOf<K>;
    for (const v of nameVariants(name)) {
      const hit = this.byNorm[kind].get(v);
      if (hit) return hit as RecordOf<K>;
    }
    return undefined;
  }

  search(opts: {
    kind?: RulesKind;
    q?: string;
    allowedSources: readonly string[] | null;
    customRules: Record<string, CustomRule>;
    isGm: boolean;
    limit?: number;
  }): RulesHit[] {
    const limit = Math.max(1, Math.min(100, opts.limit ?? 30));
    const q = (opts.q ?? '').trim().toLowerCase();
    const tokens = q ? q.split(/\s+/).filter(Boolean) : [];
    const hits: { score: number; hit: RulesHit }[] = [];

    // 1. Custom room rules (AoN imports / homebrew) first.
    for (const cr of Object.values(opts.customRules)) {
      if (cr.gmOnly && !opts.isGm) continue;
      if (opts.kind && opts.kind !== cr.kind && !(opts.kind === 'ability' && cr.kind === 'feat')) continue;
      const hay = `${cr.name} ${cr.source} ${cr.text}`.toLowerCase();
      if (tokens.length && !tokens.every((t) => hay.includes(t))) continue;
      const lowerName = cr.name.toLowerCase();
      const score = !q ? 2 : lowerName === q ? 100 : lowerName.startsWith(q) ? 50 : lowerName.includes(q) ? 20 : 5;
      hits.push({
        score: score + 1,
        hit: {
          kind: cr.kind,
          key: `custom:${cr.id}`,
          name: cr.name,
          source: { campaign: 'Custom', long: cr.source || 'Custom / AoN', short: 'Custom', page: null },
          summary: cr.cost !== null ? `${cr.cost.toLocaleString('en-US')} gp` : cr.source || cr.kind,
          ...(cr.kind === 'equipment' ? { cost: cr.cost } : {}),
          customId: cr.id,
        },
      });
    }

    // 2. Rules pack records (using pre-filtered, pre-lowercased, pre-sorted index + deferred hitSummary).
    const allowedSet = opts.allowedSources !== null ? new Set(opts.allowedSources) : null;
    const pool = opts.kind ? this.searchable[opts.kind] : this.searchableAll;

    const toHit = (rec: RulesRecord): RulesHit => ({
      kind: rec.kind,
      key: rec.key,
      name: rec.name,
      source: rec.source,
      summary: hitSummary(rec),
      ...(rec.kind === 'equipment' ? { cost: baseCost(rec as EquipmentRecord) } : {}),
    });

    if (tokens.length === 0) {
      // Fast O(limit) path: `pool` is already sorted by (canonicalBonus desc, lowerName asc).
      const need = Math.max(0, limit - hits.length);
      let taken = 0;
      for (let i = 0; i < pool.length && taken < need; i++) {
        const e = pool[i]!;
        if (allowedSet && !allowedSet.has(e.campaign)) continue;
        hits.push({ score: 1 + e.canonicalBonus, hit: toHit(e.rec) });
        taken++;
      }
      hits.sort((a, b) => b.score - a.score || a.hit.name.localeCompare(b.hit.name));
      return hits.slice(0, limit).map((x) => x.hit);
    }

    const packMatches: { score: number; lowerName: string; rec: RulesRecord }[] = [];
    const t0 = tokens[0]!;
    const multi = tokens.length > 1;
    for (let i = 0; i < pool.length; i++) {
      const e = pool[i]!;
      if (allowedSet && !allowedSet.has(e.campaign)) continue;
      if (!e.hay.includes(t0)) continue;
      if (multi) {
        let all = true;
        for (let j = 1; j < tokens.length; j++) {
          if (!e.hay.includes(tokens[j]!)) {
            all = false;
            break;
          }
        }
        if (!all) continue;
      }
      const base = e.lowerName === q ? 100 : e.lowerName.startsWith(q) ? 50 : e.lowerName.includes(q) ? 20 : 5;
      packMatches.push({ score: base + e.canonicalBonus, lowerName: e.lowerName, rec: e.rec });
    }
    packMatches.sort((a, b) => b.score - a.score || (a.lowerName < b.lowerName ? -1 : a.lowerName > b.lowerName ? 1 : 0));
    // Materialize hitSummary() & baseCost() ONLY for the top `limit` candidates.
    const topPack = packMatches.slice(0, limit);
    for (const m of topPack) hits.push({ score: m.score, hit: toHit(m.rec) });

    hits.sort((a, b) => b.score - a.score || a.hit.name.localeCompare(b.hit.name));
    return hits.slice(0, limit).map((x) => x.hit);
  }

  /** Roll or pick magic/mundane treasure items matching price band, type and slot. */
  rollTreasure(opts: {
    band?: TreasureBand;
    type?: TreasureType;
    slot?: string;
    count?: number;
    allowedSources: readonly string[] | null;
    random: (maxExclusive: number) => number;
  }): { key: string; name: string; cost: number | null; cl: number | null; slot: string | null; source: string; loot: TreasureLoot }[] {
    const band = TREASURE_BANDS.find((b) => b.id === (opts.band ?? 'any')) ?? TREASURE_BANDS[0];
    const type = opts.type ?? 'any';
    const slot = (opts.slot ?? '').trim().toLowerCase();
    const count = Math.max(1, Math.min(10, opts.count ?? 1));

    const sourcePool: EquipmentRecord[] =
      this.lists.equipment.length > 0 ? (this.lists.equipment as EquipmentRecord[]) : FALLBACK_TREASURE;

    const pool = sourcePool.filter((rec) => {
      if (rec.hidden) return false;
      if (this.lists.equipment.length > 0 && !isSourceAllowed(opts.allowedSources, rec.source.campaign)) return false;
      if (!matchesTreasureType(rec, type)) return false;
      if (slot && (rec.slot ?? '').toLowerCase() !== slot) return false;
      const c = baseCost(rec);
      if (band.id !== 'any') {
        if (c === null || c < band.min || c > band.max) return false;
      }
      return true;
    });

    if (!pool.length) return [];
    const out: { key: string; name: string; cost: number | null; cl: number | null; slot: string | null; source: string; loot: TreasureLoot }[] = [];
    for (let i = 0; i < count; i++) {
      const rec = pool[opts.random(pool.length)]!;
      out.push({
        key: rec.key,
        name: rec.name,
        cost: baseCost(rec),
        cl: rec.cl ?? rec.spellEffect?.cl ?? null,
        slot: rec.slot,
        source: `${rec.source.long}${rec.source.page ? ` ${rec.source.page}` : ''}`,
        loot: treasureFromRecord(rec, 1),
      });
    }
    return out;
  }
}

export function createRulesPackStore(dir: string): RulesPackStore {
  return new RulesPackStore(dir);
}

export type { SpellRecord };
