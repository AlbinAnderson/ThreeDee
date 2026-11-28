/**
 * PF1e spellcasting (Epic 7): per casting class, the caster level,
 * concentration, save DCs, spells per day (base + bonus + domain/school slot),
 * spells known and prepared, and the rules for casting and preparing.
 *
 * Pure and deterministic: the server uses it to authorize casts and build
 * spell cards, the client to draw the Spells tab.
 *
 * State it reads:
 *  - build.spells (from the .pcg): "Known Spells" is the spellbook / spells
 *    known; any other book (Prepared Spells, Combat Book...) is a prepared list.
 *  - runtime.prepared[class]: the VTT's prepared list for the day; a class
 *    without one uses the first prepared book in the file.
 *  - runtime.uses["spell.<class>.<level>"]: spent slots (spontaneous, hybrid).
 *  - sheet.spellcasting[class]: overrides for unknown classes or house rules.
 */
import type { Character, PreparedSpell, SpellcastingOverride } from '../entities/pf1e';
import { computeCharacterStats, type CharacterStats } from './engine';
import { sumModifiers } from './modifiers';
import { featKey, normalizeName, STAT_KEYS, type StatKey } from './rules';
import { resolveSpellRef } from '../rules/spellRef';
import type { RulesProvider } from '../rules/types';
import {
  bonusSpells,
  conversionSpell,
  isHeighten,
  isMetamagicFeat,
  lookupCasterClass,
  metamagicAdjust,
  spellSchool,
  type CasterClass,
  type CastingModel,
  type CastingTradition,
  type SpellArea,
} from './spellData';

export type ConversionKind = 'cure' | 'inflict' | 'sna';

export interface SpellLevelInfo {
  level: number;
  /** Base spells per day from the class table (null = only cantrips at will). */
  base: number | null;
  /** Bonus spells from a high casting ability. */
  bonus: number;
  /** Domain / school slot (prepared casters, levels 1+). */
  extra: number;
  /** Castings per day in normal slots (spontaneous and hybrid spend these). 0 when the ability score is too low. */
  perDay: number;
  /** How many spells may be prepared in normal slots (prepared and hybrid casters). */
  prepareLimit: number;
  /** Slots spent today (spontaneous and hybrid). */
  used: number;
  /** 0-level spells cast at will. */
  atWill: boolean;
  /** Casting ability score is at least 10 + spell level. */
  castable: boolean;
}

export interface KnownSpell {
  name: string;
  level: number;
}

export interface BookSpell {
  name: string;
  level: number;
  metamagic: string[];
  times: number;
}

export interface CasterInfo {
  className: string;
  classLevel: number;
  /** Rules-table entry, if the class is known. */
  def: CasterClass | null;
  model: CastingModel;
  tradition: CastingTradition | null;
  stat: StatKey;
  abilityMod: number;
  abilityScore: number;
  casterLevel: number;
  concentration: number;
  /** 10 + ability modifier + sheet bonus; add the spell level (and Spell Focus) for a DC. */
  dcBase: number;
  levels: SpellLevelInfo[];
  /** Highest spell level the character can cast today; -1 for none. */
  maxLevel: number;
  /** Spellbook / spells known ("Known Spells" in the .pcg). */
  known: KnownSpell[];
  /** Other books in the .pcg (prepared lists). */
  books: { name: string; spells: BookSpell[] }[];
  /** Prepared for today (prepared and hybrid casters). */
  prepared: PreparedSpell[];
  /** `prepared` comes from the .pcg because nothing was prepared in the VTT yet. */
  preparedFromFile: boolean;
  bonusSlot: 'domain' | 'school' | 'spirit' | null;
  conversions: ConversionKind[];
  /** Metamagic feats the character has (display names). */
  metamagic: string[];
  /** Spell Penetration bonus to caster level checks against spell resistance. */
  spellPenetration: number;
  warnings: string[];
}

export const KNOWN_BOOK = 'Known Spells';
const isKnownBook = (book: string | null) => !book || normalizeName(book) === normalizeName(KNOWN_BOOK);
const sameClass = (a: string | null, b: string) => !!a && normalizeName(a) === normalizeName(b);
const sameSpell = (a: string, b: string) => normalizeName(a) === normalizeName(b);

/** Key under runtime.uses for spent slots of one spell level. */
export const spellSlotKey = (className: string, level: number) => `spell.${normalizeName(className)}.${level}`;

export function ordinal(n: number): string {
  if (n === 0) return '0-level';
  const s = n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th';
  return `${n}${s}`;
}

function abilityNames(c: Character): { key: string; appliedTo: string[] }[] {
  const fromFile = c.build.abilities.map((a) => ({ key: a.key, appliedTo: a.appliedTo.map((t) => t.trim()).filter(Boolean) }));
  const legacy = [...c.build.legacyFeats, ...c.build.virtualFeats].map((f) => {
    const m = /^(.*?)\s*\((.+)\)\s*$/.exec(f);
    return { key: m ? m[1]! : f, appliedTo: m ? m[2]!.split(',').map((t) => t.trim()).filter(Boolean) : [] };
  });
  return [...fromFile, ...legacy];
}

/** Spell Focus / Greater Spell Focus bonus to the DC of spells of a school. */
function spellFocusBonus(c: Character, school: string | null): number {
  if (!school) return 0;
  const s = normalizeName(school);
  let bonus = 0;
  for (const k of ['spellfocus', 'greaterspellfocus']) {
    if (abilityNames(c).some((a) => featKey(a.key) === k && a.appliedTo.some((t) => normalizeName(t) === s))) bonus += 1;
  }
  return bonus;
}

function hasFeat(c: Character, key: string): boolean {
  return abilityNames(c).some((a) => featKey(a.key) === key);
}

function metamagicFeats(c: Character): string[] {
  const seen = new Map<string, string>();
  for (const a of abilityNames(c)) {
    const name = a.key.split('~').pop()!.trim();
    if (isMetamagicFeat(name) && !seen.has(featKey(name))) seen.set(featKey(name), name);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

function hasBonusSlot(c: Character, def: CasterClass | null, className: string): 'domain' | 'school' | 'spirit' | null {
  if (!def?.bonusSlot) return null;
  if (def.bonusSlot === 'school') {
    const sub = c.build.classes.find((k) => sameClass(k.name, className))?.subClass;
    return sub && !/universal/i.test(sub) ? 'school' : null;
  }
  if (def.bonusSlot === 'spirit') return 'spirit';
  // Clerics always get a domain slot; druids only if they chose a domain for nature bond.
  if (normalizeName(className) === 'cleric') return 'domain';
  return c.build.attributes.domains.some((d) => sameClass(d.source?.NAME ?? null, className)) ? 'domain' : null;
}

function conversionsFor(c: Character, def: CasterClass | null): ConversionKind[] {
  if (def?.convert === 'summonNaturesAlly') return ['sna'];
  if (def?.convert !== 'cureInflict') return [];
  // Good casters convert to cure, evil to inflict; neutral ones follow their chosen Channel Energy (positive -> cure, negative -> inflict).
  const align = (c.build.attributes.alignment ?? '').trim().toUpperCase();
  const isGood = (align.length === 2 && align[1] === 'G') || /\bGOOD\b/.test(align);
  const isEvil = (align.length === 2 && align[1] === 'E') || /\bEVIL\b/.test(align);
  if (isGood) return ['cure'];
  if (isEvil) return ['inflict'];
  const abKeys = c.build.abilities.map((a) => a.key.toLowerCase());
  const pos = abKeys.some((k) => k.includes('channel positive energy'));
  const neg = abKeys.some((k) => k.includes('channel negative energy'));
  if (pos && !neg) return ['cure'];
  if (neg && !pos) return ['inflict'];
  return ['cure', 'inflict'];
}

/**
 * Effective Arcane Spell Failure % for a specific arcane class's spells (CRB/APG/ACG):
 * - Bard: ignores light armor & non-tower shields
 * - Skald: ignores light/medium armor & non-tower shields
 * - Magus: ignores light (1+), medium (7+), heavy (13+) armor; shields still incur ASF
 * - Bloodrager: ignores light/medium armor; shields still incur ASF
 * - Summoner / Unchained Summoner: ignores light armor; shields still incur ASF
 */
export function casterAsf(info: Pick<CasterInfo, 'className' | 'classLevel' | 'tradition'>, stats: CharacterStats): number {
  if (info.tradition !== 'arcane') return 0;
  const cls = normalizeName(info.className);
  const { armorCategory, armorAsf, shieldAsf, towerShield } = stats.armor;
  let effectiveArmor = armorAsf;
  let effectiveShield = shieldAsf;
  if (cls === 'bard') {
    if (armorCategory === 'light') effectiveArmor = 0;
    if (!towerShield) effectiveShield = 0;
  } else if (cls === 'skald') {
    if (armorCategory === 'light' || armorCategory === 'medium') effectiveArmor = 0;
    if (!towerShield) effectiveShield = 0;
  } else if (cls === 'magus') {
    const ok =
      armorCategory === 'light' ||
      (armorCategory === 'medium' && info.classLevel >= 7) ||
      (armorCategory === 'heavy' && info.classLevel >= 13);
    if (ok) effectiveArmor = 0;
  } else if (cls === 'bloodrager') {
    if (armorCategory === 'light' || armorCategory === 'medium') effectiveArmor = 0;
  } else if (cls === 'summoner' || cls === 'summonerunchained' || cls === 'unchainedsummoner') {
    if (armorCategory === 'light') effectiveArmor = 0;
  }
  return Math.min(100, effectiveArmor + effectiveShield);
}

/** Times-expanded prepared list from the first prepared book in the .pcg, overflowing into domain/school slots when normal slots are full. */
function preparedFromBook(model: CastingModel, books: CasterInfo['books'], levels: SpellLevelInfo[]): PreparedSpell[] {
  const book = books.find((b) => b.spells.length > 0);
  if (!book) return [];
  const out: PreparedSpell[] = [];
  const seen = new Set<string>();
  const used = new Map<string, number>();
  for (const s of book.spells) {
    const times = model === 'hybrid' ? 1 : Math.max(1, Math.min(10, s.times));
    if (model === 'hybrid') {
      const k = `${normalizeName(s.name)}|${s.level}`;
      if (seen.has(k)) continue;
      seen.add(k);
    }
    const li = levels.find((x) => x.level === s.level);
    for (let i = 0; i < times; i++) {
      const normalCount = used.get(`${s.level}|normal`) ?? 0;
      const bonusCount = used.get(`${s.level}|bonus`) ?? 0;
      const slot: 'normal' | 'bonus' =
        model === 'prepared' && li && normalCount >= li.prepareLimit && bonusCount < li.extra ? 'bonus' : 'normal';
      used.set(`${s.level}|${slot}`, (used.get(`${s.level}|${slot}`) ?? 0) + 1);
      out.push({ id: `pcg-${out.length}`, name: s.name.slice(0, 80), level: s.level, metamagic: s.metamagic.slice(0, 6), slot, cast: false });
    }
  }
  return out.slice(0, 120);
}

function perDayRow(c: Character, className: string, level: number, def: CasterClass | null, o: SpellcastingOverride | undefined): (number | null)[] | null {
  if (o?.perDay) return o.perDay;
  if (def) return def.perDay[Math.max(1, Math.min(20, level)) - 1] ?? [];
  const raw = c.build.classes.find((k) => sameClass(k.name, className))?.canCastPerDay;
  if (raw && raw.trim()) {
    const row = raw.split(',').map((x) => (x.trim() === '' ? null : Number(x)));
    if (row.every((x) => x === null || Number.isFinite(x))) return row;
  }
  return null;
}

/** Every spellcasting class of a character, with its numbers for today. */
export function characterSpellcasting(c: Character, stats: CharacterStats = computeCharacterStats(c)): CasterInfo[] {
  const entries = c.build.spells.entries.filter((e) => e.spellName.trim());
  const out: CasterInfo[] = [];
  for (const k of c.build.classes) {
    if (k.level <= 0) continue;
    const def = lookupCasterClass(k.name) ?? null;
    const o = c.sheet.spellcasting[k.name];
    const mine = entries.filter((e) => sameClass(e.className, k.name));
    const myLists = c.build.spells.spellLists.filter((sl) => sameClass(sl.className, k.name));
    const fileStat = STAT_KEYS.find((s) => s === k.spellBase?.toUpperCase());
    if (!def && !o && mine.length === 0 && myLists.length === 0 && !fileStat) continue;

    const warnings: string[] = [];
    const known: KnownSpell[] = [];
    const bookMap = new Map<string, BookSpell[]>();
    for (const e of mine) {
      const level = e.level ?? 0;
      if (isKnownBook(e.book)) {
        if (!known.some((x) => sameSpell(x.name, e.spellName) && x.level === level)) known.push({ name: e.spellName, level });
      } else {
        const list = bookMap.get(e.book!) ?? [];
        list.push({ name: e.spellName, level, metamagic: e.metamagic, times: e.times ?? 1 });
        bookMap.set(e.book!, list);
      }
    }
    for (const sl of myLists) {
      const level = sl.level ?? 0;
      for (const spName of sl.spells) {
        if (!spName.trim()) continue;
        if (!known.some((x) => sameSpell(x.name, spName) && x.level === level)) known.push({ name: spName.trim(), level });
      }
    }
    known.sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
    const bookOrder = c.build.spells.spellBooks.map((b) => b.name);
    const books = [...bookMap.entries()]
      .sort(([a], [b]) => (bookOrder.indexOf(a) + 1 || 999) - (bookOrder.indexOf(b) + 1 || 999))
      .map(([name, spells]) => ({ name, spells }));

    const model: CastingModel = o?.model ?? def?.model ?? (books.length ? 'prepared' : 'spontaneous');
    const stat: StatKey = o?.stat ?? def?.stat ?? fileStat ?? 'INT';
    if (!def && !o?.stat && !fileStat) warnings.push(`Set the casting ability for ${k.name} in casting settings.`);
    const ability = stats.abilities[stat];
    const baseCl = o?.casterLevel ?? (def?.minLevel && k.level < def.minLevel ? 0 : Math.max(0, k.level + (def?.clOffset ?? 0)));
    // Buffs that raise caster level (stacking rules apply); never below 0.
    const casterLevel = baseCl > 0 ? Math.max(0, baseCl + sumModifiers(stats.effects.casterLevel).total) : 0;
    const row = perDayRow(c, k.name, k.level, def, o);
    if (!row) warnings.push(`Spells per day for ${k.name} aren't in the rules tables: set them in casting settings.`);
    const cantrips = def ? def.cantrips : true;
    const bonusSlot = model === 'prepared' ? hasBonusSlot(c, def, k.name) : null;
    const prepRow = model === 'hybrid' ? (def?.preparedPerDay?.[Math.max(1, Math.min(20, k.level)) - 1] ?? null) : null;

    const levels: SpellLevelInfo[] = [];
    for (let l = 0; l <= 9; l++) {
      const base = row?.[l] ?? null;
      const atWill = l === 0 && cantrips;
      if (base === null && !atWill) continue;
      // CRB p.555: temporary ability bonuses and ability damage do not change bonus spells per day or minimum casting score.
      const castable = ability.permanentScore >= 10 + l;
      const bonus = base !== null ? bonusSpells(ability.permanentMod, l) : 0;
      const perDay = castable && base !== null ? base + bonus : 0;
      const extra = castable && bonusSlot && l >= 1 && base !== null ? 1 : 0;
      const prepareLimit = model === 'prepared' ? perDay : model === 'hybrid' && castable ? (prepRow?.[l] ?? perDay) : 0;
      const used = model !== 'prepared' && l > 0 ? (c.runtime.uses[spellSlotKey(k.name, l)] ?? 0) : 0;
      levels.push({ level: l, base, bonus, extra, perDay, prepareLimit, used, atWill, castable });
    }
    const top = levels.filter((x) => x.castable && (x.atWill || x.perDay > 0 || x.extra > 0));
    const maxLevel = top.length ? top[top.length - 1]!.level : -1;
    const lowScore = levels.find((x) => !x.castable);
    if (lowScore) warnings.push(`${stat} ${ability.permanentScore} is too low to cast ${ordinal(lowScore.level)}-level ${k.name} spells (needs ${10 + lowScore.level}).`);

    const stored = model === 'spontaneous' ? undefined : c.runtime.prepared[k.name];
    const prepared = model === 'spontaneous' ? [] : (stored ?? preparedFromBook(model, books, levels));

    out.push({
      className: k.name,
      classLevel: k.level,
      def,
      model,
      tradition: def?.tradition ?? null,
      stat,
      abilityMod: ability.mod,
      abilityScore: ability.score,
      casterLevel,
      concentration: casterLevel + ability.mod + (hasFeat(c, 'uncannyconcentration') ? 2 : 0) + (o?.concentrationBonus ?? 0),
      dcBase: 10 + ability.mod + (o?.dcBonus ?? 0),
      levels,
      maxLevel,
      known,
      books,
      prepared,
      preparedFromFile: model !== 'spontaneous' && !stored,
      bonusSlot,
      conversions: model === 'prepared' ? conversionsFor(c, def) : [],
      metamagic: metamagicFeats(c),
      spellPenetration: (hasFeat(c, 'spellpenetration') ? 2 : 0) + (hasFeat(c, 'greaterspellpenetration') ? 2 : 0),
      warnings,
    });
  }
  return out;
}

export function casterFor(infos: CasterInfo[], className: string): CasterInfo | undefined {
  return infos.find((i) => sameClass(i.className, className));
}

/** Sum of known metamagic level increases; Heighten and unknown feats add nothing. */
export function metamagicLevels(metamagic: string[]): number {
  return metamagic.reduce((s, m) => s + (metamagicAdjust(m) ?? 0), 0);
}

/**
 * A spell's own level (for its save DC): its level in the spellbook / spells
 * known, else the slot minus metamagic. Heightened spells use the slot level.
 */
export function spellDcLevel(info: CasterInfo, name: string, slotLevel: number, metamagic: string[]): number {
  if (metamagic.some(isHeighten)) return Math.max(0, slotLevel - metamagicLevels(metamagic));
  const known = info.known.filter((k) => sameSpell(k.name, name)).map((k) => k.level);
  if (known.length) return Math.min(...known);
  return Math.max(0, slotLevel - metamagicLevels(metamagic));
}

export function spellDc(c: Character, info: CasterInfo, name: string, dcLevel: number, schoolOverride?: string | null): number {
  const rawSchool = schoolOverride ?? spellSchool(name) ?? c.rulesData.spellSchools[normalizeName(name)] ?? null;
  const school = rawSchool ? rawSchool.split(/[\s(]/)[0]! : null;
  return info.dcBase + dcLevel + spellFocusBonus(c, school);
}

/** Spell slot pools of spontaneous and hybrid casters, for pf1e/adjustUse. */
export function spellSlotPools(c: Character, infos = characterSpellcasting(c)) {
  return infos.flatMap((i) =>
    i.model === 'prepared'
      ? []
      : i.levels
          .filter((l) => l.level > 0 && l.perDay > 0)
          .map((l) => ({ key: spellSlotKey(i.className, l.level), name: `${i.className} ${ordinal(l.level)}-level slots`, unit: 'slots', used: l.used, max: l.perDay })),
  );
}

// ------------------------------------------------------------------ casting

export interface CastRequest {
  className: string;
  /** Prepared casters: which prepared spell. */
  preparedId?: string;
  /** Spontaneous / hybrid: the spell and its own level. */
  spellName?: string;
  level?: number;
  /** Spontaneous / hybrid: metamagic applied as it is cast (raises the slot). */
  metamagic?: string[];
  /** Prepared divine casters: cast a cure/inflict/Summon Nature's Ally spell instead. */
  convert?: ConversionKind;
}

export interface CastPlan {
  info: CasterInfo;
  spellName: string;
  /** Slot spent (or the prepared spell's slot). */
  slotLevel: number;
  /** Level used for the save DC. */
  dcLevel: number;
  metamagic: string[];
  preparedId: string | null;
  /** Mark the prepared spell as cast (cantrips aren't used up). */
  markCast: boolean;
  /** runtime.uses key to spend one of (spontaneous / hybrid, levels 1+). */
  slotKey: string | null;
  convertedFrom: string | null;
}

/** Whether a cast is allowed right now, and what it spends. */
export function planCast(c: Character, req: CastRequest, infos = characterSpellcasting(c)): CastPlan | string {
  const info = casterFor(infos, req.className);
  if (!info) return `${c.name} can't cast ${req.className} spells`;
  const levelInfo = (l: number) => info.levels.find((x) => x.level === l);

  if (info.model === 'prepared') {
    if (!req.preparedId) return 'Choose one of your prepared spells';
    const p = info.prepared.find((x) => x.id === req.preparedId);
    if (!p) return "That spell isn't prepared";
    const atWill = p.level === 0 && !!levelInfo(0)?.atWill;
    if (p.cast && !atWill) return `${p.name} was already cast today`;
    if (!levelInfo(p.level)?.castable) return `Your ${info.stat} is too low for ${ordinal(p.level)}-level spells`;
    if (req.convert) {
      if (!info.conversions.includes(req.convert)) return `${info.className}s can't convert spells that way`;
      if (p.slot === 'bonus') return `${info.bonusSlot === 'school' ? 'School' : info.bonusSlot === 'spirit' ? 'Spirit' : 'Domain'} slot spells can't be converted`;
      const conv = conversionSpell(req.convert, p.level);
      if (!conv) return 'Cantrips and orisons can’t be converted';
      return { info, spellName: conv[0], slotLevel: p.level, dcLevel: conv[1], metamagic: [], preparedId: p.id, markCast: true, slotKey: null, convertedFrom: p.name };
    }
    return {
      info,
      spellName: p.name,
      slotLevel: p.level,
      dcLevel: spellDcLevel(info, p.name, p.level, p.metamagic),
      metamagic: p.metamagic,
      preparedId: p.id,
      markCast: !atWill,
      slotKey: null,
      convertedFrom: null,
    };
  }

  if (req.preparedId || req.convert) return `${info.className}s cast spontaneously`;
  if (!req.spellName || req.level === undefined) return 'Choose a spell';
  const name = req.spellName;
  const level = req.level;
  const pool = info.model === 'hybrid' ? info.prepared : info.known;
  const matchedPrepared = info.model === 'hybrid' ? info.prepared.find((s) => sameSpell(s.name, name) && s.level === level) : undefined;
  if (info.model === 'hybrid' ? !matchedPrepared : !pool.some((s) => sameSpell(s.name, name) && s.level === level))
    return info.model === 'hybrid' ? `${name} isn't prepared today` : `${name} isn't a ${ordinal(level)}-level spell you know`;
  const reqMetamagic = req.metamagic ?? [];
  const prepMetamagic = matchedPrepared?.metamagic ?? [];
  const metamagic = [...prepMetamagic, ...reqMetamagic];
  const owned = new Set(info.metamagic.map(featKey));
  for (const m of reqMetamagic) {
    if (isHeighten(m)) return 'Heighten Spell is only supported for prepared spells';
    if (!owned.has(featKey(m)) || metamagicAdjust(m) === undefined) return `You don't have ${m}`;
  }
  if (new Set(metamagic.map(featKey)).size !== metamagic.length) return 'Each metamagic feat applies once';
  const slotLevel = level + metamagicLevels(reqMetamagic);
  if (slotLevel > 9) return 'That would need a slot above 9th level';
  const li = levelInfo(slotLevel);
  if (!li?.castable) return `You can't cast ${ordinal(slotLevel)}-level spells yet`;
  const dcLevel = matchedPrepared ? spellDcLevel(info, name, level, prepMetamagic) : level;
  if (slotLevel === 0 && li.atWill) {
    return { info, spellName: name, slotLevel: 0, dcLevel: 0, metamagic, preparedId: null, markCast: false, slotKey: null, convertedFrom: null };
  }
  if (li.perDay - li.used <= 0) return `No ${ordinal(slotLevel)}-level slots left today`;
  return {
    info,
    spellName: name,
    slotLevel,
    dcLevel,
    metamagic,
    preparedId: null,
    markCast: false,
    slotKey: spellSlotKey(info.className, slotLevel),
    convertedFrom: null,
  };
}

export interface SpellCard {
  title: string;
  subtitle: string;
  text: string;
  rolls: { label: string; bonus: number }[];
  area?: { kind: SpellArea['kind']; feet: number; label: string; widthFeet?: number };
}

/** The chat card for a planned cast. */
export function spellCard(c: Character, plan: CastPlan, who = c.name, rules?: RulesProvider): SpellCard {
  const { info } = plan;
  const ref = resolveSpellRef(plan.spellName, rules);
  const dc = spellDc(c, info, plan.spellName, plan.dcLevel, ref?.school);
  const raised = plan.slotLevel !== plan.dcLevel && !plan.convertedFrom;
  const subtitle = [
    `${info.className} ${ordinal(plan.slotLevel)}${raised ? ` slot (${ordinal(plan.dcLevel)}-level spell)` : ''}`,
    `CL ${info.casterLevel}`,
    ref && /^none/i.test(ref.save) ? null : `DC ${dc}`,
  ]
    .filter(Boolean)
    .join(' · ');
  const lines: string[] = [];
  if (plan.convertedFrom) lines.push(`Spontaneously cast in place of ${plan.convertedFrom}.`);
  if (plan.metamagic.length) lines.push(`Metamagic: ${plan.metamagic.join(', ')}.`);
  if (ref) {
    lines.push(ref.school);
    const details = [ref.castTime && `Casting ${ref.castTime}`, ref.components && `Components ${ref.components}`, ref.range && `Range ${ref.range}`]
      .filter(Boolean)
      .join(' · ');
    if (details) lines.push(details);
    const reach = [ref.targetArea, ref.duration && `Duration ${ref.duration}`].filter(Boolean).join(' · ');
    if (reach) lines.push(reach);
    lines.push(`Save: ${ref.save}${/^none/i.test(ref.save) ? '' : ` (DC ${dc})`} · SR: ${ref.sr}`);
    lines.push(ref.text);
    if (ref.citation) lines.push(ref.citation);
  } else {
    lines.push(`Save DC ${dc} if the spell allows a save.`);
  }
  if (info.tradition === 'arcane') {
    const asf = casterAsf(info, computeCharacterStats(c));
    if (asf > 0 && !plan.metamagic.some((m) => featKey(m) === 'stillspell')) lines.push(`Arcane spell failure ${asf}% if it has somatic components.`);
  }
  const clampBonus = (n: number) => Math.max(-100, Math.min(200, Math.round(n)));
  const rolls = [{ label: 'Concentration', bonus: clampBonus(info.concentration) }];
  if (hasFeat(c, 'combatcasting')) {
    rolls.push({ label: 'Concentration (defensive/grappled)', bonus: clampBonus(info.concentration + 4) });
  }
  if (!ref || !/^no\b/i.test(ref.sr)) rolls.push({ label: 'Caster level vs. SR', bonus: clampBonus(info.casterLevel + info.spellPenetration) });
  let area: SpellCard['area'];
  if (ref?.area) {
    // CRB p.137: Widen Spell only affects burst, emanation, or spread areas (cones are cone-shaped bursts/emanations; lines/squares/cylinders are excluded).
    const widen = plan.metamagic.some((m) => featKey(m) === 'widenspell') && /\b(burst|emanation|spread|cone)\b/i.test(ref.area.label);
    const feet = ref.area.feet * (widen ? 2 : 1);
    area = { kind: ref.area.kind, feet, label: widen ? `${ref.area.label} (widened to ${feet} ft.)` : ref.area.label, ...(ref.area.kind === 'line' ? { widthFeet: 5 } : {}) };
  }
  return {
    title: `${who}: ${plan.spellName}`.slice(0, 120),
    subtitle: subtitle.slice(0, 120),
    text: lines.join('\n').slice(0, 2000),
    rolls,
    ...(area ? { area: { ...area, label: area.label.slice(0, 60) } } : {}),
  };
}

// ------------------------------------------------------------------ preparing

export interface PrepareEntry {
  id: string;
  name: string;
  level: number;
  metamagic: string[];
  slot: 'normal' | 'bonus';
}

/** Whether a day's prepared list fits the class's slots and spellbook. */
export function checkPrepared(c: Character, className: string, list: PrepareEntry[], infos = characterSpellcasting(c)): true | string {
  const info = casterFor(infos, className);
  if (!info) return `${c.name} can't cast ${className} spells`;
  if (info.model === 'spontaneous') return `${info.className}s don't prepare spells`;
  if (new Set(list.map((p) => p.id)).size !== list.length) return 'Duplicate prepared spell id';
  const owned = new Set(info.metamagic.map(featKey));
  const counts = new Map<string, number>();
  const hybridSeen = new Set<string>();
  for (const p of list) {
    const li = info.levels.find((x) => x.level === p.level);
    if (!li || !li.castable) return `You can't prepare ${ordinal(p.level)}-level ${info.className} spells`;
    if (p.slot === 'bonus' && (p.level === 0 || li.extra === 0)) return `No ${info.bonusSlot ?? 'bonus'} slot at ${ordinal(p.level)} level`;
    if (new Set(p.metamagic.map(featKey)).size !== p.metamagic.length) return 'Each metamagic feat applies once';
    for (const m of p.metamagic) if (!owned.has(featKey(m))) return `You don't have ${m}`;
    if (info.model === 'hybrid') {
      const mmSig = [...p.metamagic].map(featKey).sort().join(',');
      const hk = `${normalizeName(p.name)}|${p.level}|${mmSig}`;
      if (hybridSeen.has(hk)) return `${p.name} is already prepared at ${ordinal(p.level)} level`;
      hybridSeen.add(hk);
    }
    const knownLevels = info.known.filter((k) => sameSpell(k.name, p.name)).map((k) => k.level);
    const inBook = knownLevels.length > 0;
    if (info.def?.book && !inBook) return `${p.name} isn't in your ${info.def.noun === 'extracts' ? 'formula book' : 'spellbook'}`;
    const adj = metamagicLevels(p.metamagic);
    if (inBook) {
      const base = Math.min(...knownLevels);
      // CRB p.218: a prepared caster may fill any higher-level slot with a lower-level spell.
      if (p.level < base + adj) return `${p.name} needs at least a ${ordinal(Math.min(9, base + adj))}-level slot`;
    } else if (p.level < adj) return `${p.name} needs a higher slot for its metamagic`;
    const key = `${p.level}|${p.slot}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  for (const li of info.levels) {
    const normal = counts.get(`${li.level}|normal`) ?? 0;
    const limit = li.prepareLimit;
    if (normal > limit) return `Too many ${ordinal(li.level)}-level spells prepared (${normal}/${limit})`;
    const bonus = counts.get(`${li.level}|bonus`) ?? 0;
    if (bonus > li.extra) return `Only ${li.extra} ${info.bonusSlot ?? 'bonus'} slot at ${ordinal(li.level)} level`;
  }
  return true;
}

/** Spells a caster may prepare: the spellbook / known list, plus anything in the .pcg's prepared books. */
export function preparableSpells(info: CasterInfo): KnownSpell[] {
  const out = [...info.known];
  if (!info.def?.book) {
    for (const b of info.books) {
      for (const s of b.spells) {
        const level = Math.max(0, s.level - metamagicLevels(s.metamagic));
        if (!out.some((k) => sameSpell(k.name, s.name))) out.push({ name: s.name, level });
      }
    }
  }
  return out.sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
}
