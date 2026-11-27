/**
 * PCGen `.pcc` + `.lst` rules pack builder (Epic 11, #52).
 *
 * Walks a PCGen Pathfinder data folder (and optional `homebrew/` folder),
 * follows `.pcc` manifests, reads plain fields from `.lst` files (equipment,
 * equipmods, spells, feats, abilities, deities, domains), applies `.COPY`,
 * `.MOD` and `.FORGET` across books, and writes compact searchable JSON into
 * `DATA_DIR/rules/` (never committed to git).
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  KNOWLEDGES,
  RULES_KINDS,
  skillDef,
  STAT_KEYS,
  type ClassRecord,
  type DeityRecord,
  type EquipmentRecord,
  type EquipmodRecord,
  type FeatRecord,
  type RaceRecord,
  type RulesBonus,
  type RulesBook,
  type RulesKind,
  type RulesManifest,
  type RulesRecord,
  type RulesSource,
  type SaveKey,
  type SizeName,
  type SpellRecord,
  type StatKey,
} from '@vtt/shared';

interface PccFileRef {
  kind: RulesKind;
  filePath: string;
}

interface ParsedPcc {
  key: string;
  name: string;
  short: string;
  publisher: string;
  bookType: string;
  pccPath: string;
  files: PccFileRef[];
  includes: string[];
  /** From the sibling `homebrew/` folder: may .MOD/.FORGET any publisher's records. */
  homebrew?: boolean;
}

const PCC_KIND_TAG: Record<string, RulesKind> = {
  EQUIPMENT: 'equipment',
  EQUIPMOD: 'equipmod',
  SPELL: 'spell',
  FEAT: 'feat',
  ABILITY: 'ability',
  DEITY: 'deity',
  DOMAIN: 'domain',
  CLASS: 'class',
  RACE: 'race',
};

const SIZE_CODE: Record<string, SizeName> = {
  F: 'Fine',
  D: 'Diminutive',
  T: 'Tiny',
  S: 'Small',
  M: 'Medium',
  L: 'Large',
  H: 'Huge',
  G: 'Gargantuan',
  C: 'Colossal',
};

type StaticBonusType = RulesBonus['type'];

const PCGEN_BONUS_TYPE: Record<string, StaticBonusType> = {
  alchemical: 'alchemical',
  armor: 'armor',
  circumstance: 'circumstance',
  competence: 'competence',
  deflection: 'deflection',
  dodge: 'dodge',
  enhancement: 'enhancement',
  inherent: 'inherent',
  insight: 'insight',
  luck: 'luck',
  morale: 'morale',
  natural: 'natural',
  naturalarmor: 'natural',
  // PF1e: Amulet of Natural Armor / Barkskin give an enhancement bonus to natural armor (same slot as Barkskin).
  naturalarmorenhancement: 'enhancement',
  profane: 'profane',
  racial: 'racial',
  resistance: 'resistance',
  sacred: 'sacred',
  shield: 'shield',
  size: 'size',
  trait: 'trait',
};

const CLOAK_SAVE_VAR: Record<string, SaveKey> = {
  fortitudesave_resistancebonus: 'fort',
  reflexsave_resistancebonus: 'ref',
  willsave_resistancebonus: 'will',
};

function parseBonusType(rest: string[]): StaticBonusType | null {
  let sawTypeTag = false;
  for (const seg of rest) {
    if (!/^TYPE=/i.test(seg.trim())) continue;
    sawTypeTag = true;
    const raw = seg.trim().slice(5);
    for (const part of raw.split(/[.,]/)) {
      const k = part.trim().toLowerCase().replace(/[^a-z]/g, '');
      if (!k || k === 'replace' || k === 'stack' || k === 'nonstack') continue;
      if (k in PCGEN_BONUS_TYPE) return PCGEN_BONUS_TYPE[k]!;
    }
  }
  // If TYPE= was specified with only unrecognized types (e.g. ArmorEnhancement, ShieldEnhancement),
  // return null so the bonus is rejected instead of falling through to stacking 'untyped'.
  return sawTypeTag ? null : 'untyped';
}

/**
 * Parse unconditional, literal-integer static `BONUS:` tags from PCGen `.lst`
 * tokens (Epic 13.2). Rejects any bonus with `PRE*` guards, formulas, decimals,
 * `%CHOICE`, `LIST`, unmapped `TYPE=`, or unwhitelisted variables so there are zero false positives.
 */
export function parseStaticBonuses(tokens: string[], kind: RulesKind, types: string[] = []): RulesBonus[] {
  // Equipment or race records gated by a standalone tab-level PRExxx (e.g. Dwarven-only magic items)
  // have conditional bonuses that don't apply universally.
  if ((kind === 'equipment' || kind === 'race') && tokens.some((t) => /^!?PRE[A-Z]/i.test(t.trim()))) return [];

  const out: RulesBonus[] = [];
  const seen = new Set<string>();
  const isArmorOrShield = kind === 'equipment' && types.some((t) => /^(armor|shield)$/i.test(t));
  const isWeapon = kind === 'equipment' && types.some((t) => /^weapon$/i.test(t));
  const push = (b: RulesBonus) => {
    const sig = `${b.target}|${b.skill ?? ''}|${b.value}|${b.type}`;
    if (seen.has(sig) || out.length >= 20) return;
    seen.add(sig);
    out.push(b);
  };

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]!;
    if (!/^BONUS:/i.test(tok)) continue;
    // Skip if the immediately following tab token is a standalone PRE* guard.
    if (i + 1 < tokens.length && /^!?PRE[A-Z]/i.test(tokens[i + 1]!.trim())) continue;
    const parts = tok.split('|');
    if (parts.length < 3) continue;
    const category = parts[0]!.slice(6).trim().toUpperCase();
    const targetRaw = parts[1]!.trim();
    const valRaw = parts[2]!.trim();
    const rest = parts.slice(3);

    // Reject any conditional bonus (PRE*, !PRE* anywhere in trailing segments or target).
    if (rest.some((s) => /^!?PRE/i.test(s.trim()))) continue;
    if (/^!?PRE/i.test(targetRaw)) continue;
    // Strict signed integer literal only (accepts -2, rejects decimals, formulas, variables, LIST, %CHOICE).
    if (!/^[+-]?\d+$/.test(valRaw)) continue;
    const value = Number(valRaw);
    if (!Number.isInteger(value) || value === 0 || value < -50 || value > 50) continue;

    const type = parseBonusType(rest);
    if (type === null) continue;

    if (category === 'STAT') {
      const targets = targetRaw.split(',').map((s) => s.trim().toUpperCase());
      if (targets.some((t) => t === 'LIST' || t.includes('%'))) continue;
      for (const t of targets) {
        if ((STAT_KEYS as string[]).includes(t)) push({ target: t as StatKey, value, type });
      }
    } else if (category === 'SAVE' || category === 'CHECKS') {
      const targets = targetRaw.split(',').map((s) => s.trim());
      if (targets.some((t) => /^BASE\./i.test(t) || /^(LIST|ALL\.|%)/i.test(t))) continue;
      for (const t of targets) {
        const l = t.toLowerCase();
        if (l === 'fortitude' || l === 'fort') push({ target: 'fort', value, type });
        else if (l === 'reflex' || l === 'ref') push({ target: 'ref', value, type });
        else if (l === 'will') push({ target: 'will', value, type });
        else if (l === 'all') push({ target: 'saves', value, type });
      }
    } else if (category === 'VAR') {
      const vars = targetRaw.split(',').map((s) => s.trim().toLowerCase());
      if (!vars.length || !vars.every((v) => v in CLOAK_SAVE_VAR)) continue;
      const saveType: StaticBonusType = type === 'untyped' ? 'resistance' : type;
      const mapped = [...new Set(vars.map((v) => CLOAK_SAVE_VAR[v]!))];
      if (mapped.length === 3) push({ target: 'saves', value, type: saveType });
      else for (const s of mapped) push({ target: s, value, type: saveType });
    } else if (category === 'COMBAT') {
      const t = targetRaw.toUpperCase();
      if (t === 'AC') {
        // Armor/shield items already carry their bonus/enhancement in `item.armor`; weapons carry theirs in `item.weapon`.
        if (isArmorOrShield && (type === 'armor' || type === 'shield' || type === 'enhancement')) continue;
        if (isWeapon && type === 'enhancement') continue;
        push({ target: 'ac', value, type });
      } else if (t === 'INITIATIVE') {
        push({ target: 'initiative', value, type });
      } else if (t === 'TOHIT' || t === 'TOHIT.MELEE' || t === 'TOHIT.RANGED') {
        if (isWeapon && type === 'enhancement') continue;
        const target = t === 'TOHIT.MELEE' ? 'attackMelee' : t === 'TOHIT.RANGED' ? 'attackRanged' : 'attack';
        push({ target, value, type });
      } else if (t === 'DAMAGE' || t === 'DAMAGE.MELEE' || t === 'DAMAGE.RANGED') {
        if (isWeapon && type === 'enhancement') continue;
        const target = t === 'DAMAGE.MELEE' ? 'damageMelee' : t === 'DAMAGE.RANGED' ? 'damageRanged' : 'damage';
        push({ target, value, type });
      }
    } else if (category === 'SKILL') {
      const targets = targetRaw.split(',').map((s) => s.trim());
      for (const rawSkill of targets) {
        if (!rawSkill || /^(TYPE=|STAT\.|LIST|%CHOICE|ALL\b)/i.test(rawSkill)) continue;
        if (!skillDef(rawSkill)) continue;
        push({ target: 'skill', skill: rawSkill.slice(0, 60), value, type });
      }
    } else if (category === 'MOVEADD') {
      if (/^TYPE[=.]Walk$/i.test(targetRaw)) push({ target: 'speed', value, type });
    } else if (category === 'HP') {
      if (targetRaw.toUpperCase() === 'CURRENTMAX') push({ target: 'hp', value, type });
    }
  }
  return out;
}

function parseCskills(raw: string, base: string[] = []): string[] {
  let out = [...base];
  for (const part of raw.split('|')) {
    const s = part.trim();
    if (!s) continue;
    if (s.toUpperCase() === '.CLEAR') {
      out = [];
      continue;
    }
    if (/^(LIST|%CHOICE|ALL)$/i.test(s)) continue;
    if (/^TYPE=Knowledge$/i.test(s)) {
      for (const k of KNOWLEDGES) {
        const name = `Knowledge (${k})`;
        if (!out.includes(name)) out.push(name);
      }
      continue;
    }
    const fam = /^TYPE=(Craft|Perform|Profession)$/i.exec(s);
    if (fam) {
      const name = fam[1]!.charAt(0).toUpperCase() + fam[1]!.slice(1).toLowerCase();
      if (!out.includes(name)) out.push(name);
      continue;
    }
    if (/^TYPE=/i.test(s)) continue;
    if (skillDef(s) && !out.includes(s)) out.push(s.slice(0, 60));
  }
  return out.slice(0, 40);
}

function parseVision(raw: string): { darkvision: number; lowLight: boolean } {
  let darkvision = 0;
  let lowLight = false;
  for (const seg of raw.split('|')) {
    const dv = /Darkvision\s*\(\s*(\d+)\s*'?\s*\)/i.exec(seg);
    if (dv) darkvision = Math.max(darkvision, Math.min(600, Number(dv[1])));
    if (/Low-Light\s+Vision/i.test(seg)) lowLight = true;
  }
  return { darkvision, lowLight };
}

function parseClassProgressions(cls: ClassRecord, tokens: string[]) {
  let babFromBaseAb: 'full' | 'threeQuarter' | 'half' | null = null;
  let babFromVar: 'full' | 'threeQuarter' | 'half' | null = null;
  for (const tok of tokens) {
    if (/^BONUS:COMBAT\|BASEAB\|/i.test(tok)) {
      const expr = (tok.split('|')[2] ?? '').replace(/\s+/g, '');
      if (/\*3\/4|\*3\)\/4|\*0\.75/i.test(expr)) babFromBaseAb = 'threeQuarter';
      else if (/\/2\b|\*0\.5/i.test(expr)) babFromBaseAb = 'half';
      else if (/^(?:classlevel\([^)]*\)|CL)$/i.test(expr)) babFromBaseAb = 'full';
    } else if (/^BONUS:VAR\|ClassBAB(Full|Moderate|Poor|Low)\|/i.test(tok)) {
      const m = /^BONUS:VAR\|ClassBAB(Full|Moderate|Poor|Low)\|/i.exec(tok);
      const kind = m?.[1]?.toLowerCase();
      if (kind === 'full') babFromVar = 'full';
      else if (kind === 'moderate') babFromVar = 'threeQuarter';
      else if (kind === 'poor' || kind === 'low') babFromVar = 'half';
    } else if (/^BONUS:SAVE\|/i.test(tok)) {
      const parts = tok.split('|');
      const targets = (parts[1] ?? '').split(',');
      const expr = parts[2] ?? '';
      const isGood = /\/2(?:\+2|\b)/.test(expr);
      if (!isGood) continue;
      for (const t of targets) {
        const m = /^BASE\.(Fortitude|Reflex|Will)$/i.exec(t.trim());
        if (!m) continue;
        const k: SaveKey = m[1]!.toLowerCase().startsWith('f') ? 'fort' : m[1]!.toLowerCase().startsWith('r') ? 'ref' : 'will';
        if (!cls.goodSaves.includes(k)) cls.goodSaves.push(k);
      }
    } else if (/^BONUS:VAR\|ClassSaveGood_(Fortitude|Reflex|Will)\|/i.test(tok)) {
      const m = /^BONUS:VAR\|ClassSaveGood_(Fortitude|Reflex|Will)\|/i.exec(tok);
      if (!m) continue;
      const k: SaveKey = m[1]!.toLowerCase().startsWith('f') ? 'fort' : m[1]!.toLowerCase().startsWith('r') ? 'ref' : 'will';
      if (!cls.goodSaves.includes(k)) cls.goodSaves.push(k);
    }
  }
  // Prefer authoritative BONUS:COMBAT|BASEAB over fractional ClassBAB* vars (PCGen has a known Dragon Disciple typo in ClassBABFull).
  if (babFromBaseAb) cls.bab = babFromBaseAb;
  else if (!cls.bab && babFromVar) cls.bab = babFromVar;
}

function cleanDesc(raw: string): string {
  // Strip trailing formula args after `|` in DESC:foo|%1|VAR and collapse placeholders.
  const first = raw.split('|')[0] ?? raw;
  return first
    .replace(/&nl;/gi, '\n')
    .replace(/&pipe;/gi, '|')
    .replace(/%\d+/g, 'X')
    .replace(/%%/g, '%')
    .replace(/\s+\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .trim()
    .slice(0, 4000);
}

function numOrNull(raw: string | undefined): number | null {
  if (!raw) return null;
  const s = raw.trim();
  if (!/^[+-]?\d+(?:\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Merge PCGen TYPE values (respecting CLEAR). */
function mergeTypes(prev: string[], raw: string): string[] {
  const parts = raw.split('.').map((t) => t.trim()).filter(Boolean);
  let out = [...prev];
  for (const p of parts) {
    if (p.toUpperCase() === 'CLEAR') out = [];
    else if (!out.some((x) => x.toLowerCase() === p.toLowerCase())) out.push(p);
  }
  return out;
}

/** Resolve a `.pcc` file reference (`foo.lst`, `@/pathfinder/...`, `*(EXCLUDE:...)`). */
function resolvePccRef(pccDir: string, dataRoot: string, rawVal: string): string | null {
  const ref = rawVal.split('|')[0]!.trim();
  if (!ref) return null;
  if (ref.startsWith('@/') || ref.startsWith('@\\')) {
    const rel = ref.slice(2).replace(/\\/g, '/');
    const direct = path.resolve(dataRoot, rel);
    if (fs.existsSync(direct)) return direct;
    // If dataRoot is already `.../data/pathfinder`, try its parent `.../data`.
    const parent = path.resolve(dataRoot, '..', rel);
    if (fs.existsSync(parent)) return parent;
    return direct;
  }
  return path.resolve(pccDir, ref.replace(/\\/g, '/'));
}

/** Parse one `.pcc` manifest file. */
export function parsePccFile(pccPath: string, dataRoot: string): ParsedPcc {
  const dir = path.dirname(pccPath);
  const raw = fs.readFileSync(pccPath, 'utf8');
  let campaign = '';
  let key = '';
  let sourceLong = '';
  let sourceShort = '';
  let publisher = '';
  let bookType = '';
  const files: PccFileRef[] = [];
  const includes: string[] = [];

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const colon = trimmed.indexOf(':');
    if (colon === -1) continue;
    const tag = trimmed.slice(0, colon).trim().toUpperCase();
    const val = trimmed.slice(colon + 1).trim();
    if (!val) continue;
    if (tag === 'CAMPAIGN') campaign = val;
    else if (tag === 'KEY') key = val;
    else if (tag === 'SOURCELONG') sourceLong = val;
    else if (tag === 'SOURCESHORT') sourceShort = val;
    else if (tag === 'PUBNAMELONG' || (!publisher && tag === 'PUBNAMESHORT')) publisher = val;
    else if (tag === 'BOOKTYPE') bookType = val;
    else if (tag === 'PCC') {
      const resolved = resolvePccRef(dir, dataRoot, val);
      if (resolved) includes.push(resolved);
    } else if (tag in PCC_KIND_TAG) {
      const resolved = resolvePccRef(dir, dataRoot, val);
      if (resolved) files.push({ kind: PCC_KIND_TAG[tag]!, filePath: resolved });
    }
  }

  const fallback = path.basename(pccPath, path.extname(pccPath));
  const name = sourceLong || campaign || fallback;
  return {
    key: (key || campaign || name).slice(0, 120),
    name: name.slice(0, 160),
    short: (sourceShort || name.slice(0, 12)).slice(0, 40),
    publisher: (publisher || 'Unknown').slice(0, 80),
    bookType: (bookType || 'Supplement').slice(0, 40),
    pccPath,
    files,
    includes,
  };
}

/** Summarise PCGen PRExxx tokens into a short readable prerequisite string. */
function formatPrereqs(tokens: string[]): string {
  const parts: string[] = [];
  for (const tok of tokens) {
    if (!tok.startsWith('PRE')) continue;
    const colon = tok.indexOf(':');
    if (colon === -1) continue;
    const tag = tok.slice(0, colon).toUpperCase();
    const val = tok.slice(colon + 1);
    if (tag === 'PREFEAT' || tag === 'PREABILITY') {
      const items = val.split(',').slice(1).filter((x) => !/^CATEGORY=/i.test(x) && !/^TYPE\./i.test(x));
      if (items.length) parts.push(items.map((x) => x.replace(/.*~\s*/, '').trim()).join(', '));
    } else if (tag === 'PRESTAT') {
      const items = val.split(',').slice(1).map((x) => x.replace('=', ' '));
      if (items.length) parts.push(items.join(', '));
    } else if (tag === 'PREATT' || tag === 'PRETOTALAB') {
      parts.push(`BAB +${val.split(',')[0]}`);
    } else if (tag === 'PREVARGTEQ') {
      // PCGen 6 feats: PREVARGTEQ:PreStatScore_STR,13
      const m = /^PreStatScore_([A-Z]{3}),(\d+)$/i.exec(val.trim());
      if (m) parts.push(`${m[1]!.toUpperCase()} ${m[2]}`);
    } else if (tag === 'PRESKILL') {
      const items = val.split(',').slice(1).map((x) => x.replace('=', ' ') + ' ranks');
      if (items.length) parts.push(items.join(', '));
    } else if (tag === 'PRECLASS') {
      const items = val.split(',').slice(1).map((x) => x.replace('=', ' '));
      if (items.length) parts.push(items.join(' or '));
    } else if (tag === 'PRELEVEL') {
      const m = /MIN=(\d+)/i.exec(val);
      if (m) parts.push(`Character level ${m[1]}`);
    } else if (tag === 'PRERACE') {
      const items = val.split(',').slice(1).map((x) => x.replace(/%$/, ''));
      if (items.length) parts.push(items.join(' or '));
    }
  }
  return [...new Set(parts)].join('; ').slice(0, 400);
}

/** Parse PCGen CLASSES:Wizard,Sorcerer=3|Magus=3 into { Wizard: 3, Sorcerer: 3, Magus: 3 }. */
function parseClassLevels(raw: string, base: Record<string, number> = {}): Record<string, number> {
  const out = { ...base };
  for (const seg of raw.split('|')) {
    if (seg.toUpperCase() === 'CLEAR') {
      for (const k of Object.keys(out)) delete out[k];
      continue;
    }
    const eq = seg.lastIndexOf('=');
    if (eq === -1) continue;
    const lvl = Number(seg.slice(eq + 1));
    if (!Number.isInteger(lvl) || lvl < 0 || lvl > 9) continue;
    for (const cls of seg.slice(0, eq).split(',')) {
      const name = cls.replace(/\[.*?\]/g, '').trim();
      if (name && name.toUpperCase() !== 'ALL') out[name.slice(0, 60)] = lvl;
    }
  }
  return out;
}

/** Parse `BONUS:COMBAT|AC|n|TYPE=Armor` / `TYPE=Shield` from equipment tokens. */
function parseAcBonus(tokens: string[]): number | null {
  let best: number | null = null;
  for (const t of tokens) {
    const m = /^BONUS:COMBAT\|AC\|([+-]?\d+)\|TYPE=(?:Armor|Shield)/i.exec(t);
    if (m) {
      const v = Number(m[1]);
      if (Number.isFinite(v) && (best === null || v > best)) best = v;
    }
  }
  return best;
}

function parseSpellEffectFromTokens(tokens: string[]): EquipmentRecord['spellEffect'] {
  for (const t of tokens) {
    if (!t.startsWith('EQMOD:')) continue;
    // PCGen 6: EQMOD:Special Ability ~ Spell Effect / Single Use|SPELLNAME[Cure Light Wounds]SPELLLEVEL[1]CASTERLEVEL[1]
    for (const mod of t.slice(6).split(/\.(?=[A-Z][^|]*~)/)) {
      if (!/spell effect/i.test(mod.split('|')[0] ?? '')) continue;
      const name = /SPELLNAME\[([^\]]+)\]/i.exec(mod)?.[1]?.trim();
      const level = /SPELLLEVEL\[(\d+)\]/i.exec(mod)?.[1];
      const cl = /CASTERLEVEL\[(\d+)\]/i.exec(mod)?.[1];
      if (name && level !== undefined && cl !== undefined) {
        return { name: name.slice(0, 120), level: Math.max(0, Math.min(9, Number(level))), cl: Math.max(1, Math.min(30, Number(cl))) };
      }
    }
    // Older data: SPL_CHRG|Spell|level|CL
    const m = /(?:SPL_CHRG|SPL_1USE|POTION|SCROLL|WAND)\|([^|\]]+)\|(\d+)\|(\d+)/i.exec(t);
    if (m) return { name: m[1]!.trim(), level: Number(m[2]), cl: Number(m[3]) };
  }
  for (const t of tokens) {
    if (t.startsWith('SPELLS:')) {
      // SPELLS:Innate|TIMES=1|CASTERLEVEL=5|Fireball
      const parts = t.slice(7).split('|');
      const clTok = parts.find((p) => /^CASTERLEVEL=\d+$/i.test(p));
      const spell = parts.find((p) => !p.includes('=') && p.toUpperCase() !== 'INNATE' && p.toUpperCase() !== 'MAGICITEM');
      if (spell && clTok) {
        const cl = Number(clTok.split('=')[1]);
        if (Number.isFinite(cl)) return { name: spell.split(',')[0]!.trim(), level: Math.max(0, Math.min(9, Math.ceil(cl / 2))), cl };
      }
    }
  }
  return null;
}

/**
 * PCGen DESC is additive (each DESC tag adds a paragraph; DESC:.CLEAR resets).
 * Conditional paragraphs: `|PRERULE:1,DisplayFullSpell` is the full text,
 * `|!PRERULE:1,DisplayFullSpell` the short one; other PRExxx conditions (mythic
 * versions, feat-dependent riders) don't describe the base record.
 */
interface DescParts {
  normal: string[];
  full: string[];
  short: string[];
}
const descParts = new WeakMap<RulesRecord, DescParts>();
/** Side-channel metadata captured on ability records for post-pass class/race enrichment (never serialized). */
const abilityCskills = new WeakMap<RulesRecord, string[]>();
const abilityVision = new WeakMap<RulesRecord, { darkvision: number; lowLight: boolean }>();
const abilityHasAnyPlusTwo = new WeakMap<RulesRecord, boolean>();
const abilitySize = new WeakMap<RulesRecord, SizeName>();

function addDesc(parts: DescParts, raw: string) {
  if (raw.trim().toUpperCase() === '.CLEAR') {
    parts.normal = [];
    parts.full = [];
    parts.short = [];
    return;
  }
  const segs = raw.split('|');
  const conds = segs.slice(1).filter((x) => /^!?PRE[A-Z]+:/i.test(x.trim()));
  const text = cleanDesc(raw);
  if (!text) return;
  if (!conds.length) parts.normal.push(text);
  else if (conds.length === 1 && /^PRERULE:1,DisplayFullSpell$/i.test(conds[0]!.trim())) parts.full.push(text);
  else if (conds.length === 1 && /^!PRERULE:1,DisplayFullSpell$/i.test(conds[0]!.trim())) parts.short.push(text);
}

function joinDesc(parts: DescParts): string {
  const body = parts.normal.length || parts.full.length ? [...parts.normal, ...parts.full] : parts.short;
  return body.join('\n\n').slice(0, 4000);
}

function applyFields(_kind: RulesKind, rec: RulesRecord, tokens: string[], defaultSource: RulesSource, isMod = false): RulesRecord {
  const next = {
    ...rec,
    source: { ...rec.source },
    types: [...rec.types],
    ...(rec.bonuses ? { bonuses: [...rec.bonuses] } : {}),
  } as RulesRecord;
  const prevDesc = descParts.get(rec);
  const desc: DescParts = prevDesc ? { normal: [...prevDesc.normal], full: [...prevDesc.full], short: [...prevDesc.short] } : { normal: rec.desc ? [rec.desc] : [], full: [], short: [] };
  descParts.set(next, desc);
  const prevCskills = abilityCskills.get(rec);
  if (prevCskills) abilityCskills.set(next, [...prevCskills]);
  const prevVision = abilityVision.get(rec);
  if (prevVision) abilityVision.set(next, { ...prevVision });
  if (abilityHasAnyPlusTwo.get(rec)) abilityHasAnyPlusTwo.set(next, true);
  const prevSize = abilitySize.get(rec);
  if (prevSize) abilitySize.set(next, prevSize);
  if (next.kind === 'class') {
    const c = next as ClassRecord;
    c.goodSaves = [...c.goodSaves];
    c.classSkills = [...c.classSkills];
  } else if (next.kind === 'race') {
    const r = next as RaceRecord;
    r.abilityMods = { ...r.abilityMods };
    r.skillBonuses = { ...r.skillBonuses };
  }
  const prereqToks: string[] = [];

  for (const tok of tokens) {
    if (tok.startsWith('PRE')) prereqToks.push(tok);
    const colon = tok.indexOf(':');
    if (colon === -1) continue;
    const tag = tok.slice(0, colon).toUpperCase();
    const val = tok.slice(colon + 1);

    if (tag === 'KEY') next.key = val.trim().slice(0, 160);
    else if (tag === 'OUTPUTNAME') {
      const cleaned = val.replace(/\[NAME\]/g, next.name).trim();
      if (cleaned) next.name = cleaned.slice(0, 160);
    } else if (tag === 'SOURCELONG' || tag === 'SOURCESHORT' || tag === 'SOURCEPAGE') {
      // A .MOD from another book ("also in Ultimate Equipment p.10") keeps the record's own citation.
      if (!isMod) {
        if (tag === 'SOURCELONG') next.source.long = val.trim().slice(0, 160);
        else if (tag === 'SOURCESHORT') next.source.short = val.trim().slice(0, 40);
        else next.source.page = val.trim().slice(0, 40) || null;
      }
    } else if (tag === 'DESC') addDesc(desc, val);
    else if (tag === 'TYPE') next.types = mergeTypes(next.types, val);
    else if (tag === 'VISIBLE') {
      const v = val.trim().toUpperCase();
      if (v === 'NO' || v === 'EXPORT') next.hidden = true;
      else if (v === 'YES' || v === 'DISPLAY') next.hidden = false;
    }

    if (next.kind === 'equipment') {
      const eq = next as EquipmentRecord;
      if (tag === 'COST') eq.cost = numOrNull(val);
      else if (tag === 'WT') eq.weight = numOrNull(val);
      else if (tag === 'BASEQTY') {
        const q = numOrNull(val);
        if (q !== null && q > 1) eq.baseQty = Math.min(1000, Math.floor(q));
        else delete eq.baseQty;
      }
      else if (tag === 'BASEITEM') eq.baseItem = val.trim().slice(0, 160) || null;
      else if (tag === 'DAMAGE') eq.damage = val.trim().slice(0, 20) || null;
      else if (tag === 'CRITRANGE') eq.critRange = numOrNull(val);
      else if (tag === 'CRITMULT') {
        const m = /x(\d+)/i.exec(val);
        eq.critMult = m ? Number(m[1]) : numOrNull(val);
      } else if (tag === 'RANGE') eq.range = numOrNull(val);
      else if (tag === 'WIELD') eq.wield = val.trim().slice(0, 40) || null;
      else if (tag === 'MAXDEX') eq.maxDex = numOrNull(val);
      else if (tag === 'ACCHECK') eq.acp = numOrNull(val);
      else if (tag === 'SPELLFAILURE') eq.asf = numOrNull(val);
      else if (tag === 'EQMOD') {
        const mods = val.split('.').map((x) => x.split('|')[0]!.trim()).filter(Boolean);
        eq.eqmods = [...new Set([...eq.eqmods, ...mods])].slice(0, 30);
      } else if (tag === 'QUALITY') {
        const pipe = val.indexOf('|');
        if (pipe !== -1) {
          const qk = val.slice(0, pipe).trim().toLowerCase();
          const qv = val.slice(pipe + 1).trim();
          if (qk === 'slot') eq.slot = qv.toLowerCase().slice(0, 40);
          else if (qk === 'caster level') {
            const m = /(\d+)/.exec(qv);
            if (m) eq.cl = Number(m[1]);
          } else if (qk === 'aura') eq.aura = qv.slice(0, 120);
        }
      }
    } else if (next.kind === 'equipmod') {
      const em = next as EquipmodRecord;
      if (tag === 'COST') em.cost = val.trim().slice(0, 80) || null;
      else if (tag === 'ITYPE') em.itypes = mergeTypes(em.itypes, val);
    } else if (next.kind === 'spell') {
      const sp = next as SpellRecord;
      // SCHOOL adds schools (APG elemental "FireSchool" tags): keep the first real one.
      if (tag === 'SCHOOL') sp.school = sp.school ?? (val.trim().slice(0, 60) || null);
      else if (tag === 'SUBSCHOOL') sp.subschool = val.trim().slice(0, 60) || null;
      else if (tag === 'DESCRIPTOR') {
        sp.descriptors = [...new Set([...sp.descriptors, ...val.split('|').map((d) => d.trim()).filter(Boolean)])].slice(0, 12);
      } else if (tag === 'CLASSES') sp.classes = parseClassLevels(val, sp.classes);
      else if (tag === 'DOMAINS') sp.domains = parseClassLevels(val, sp.domains);
      else if (tag === 'CASTTIME') sp.castTime = val.trim().slice(0, 80) || null;
      else if (tag === 'COMPS') sp.components = val.trim().slice(0, 80) || null;
      else if (tag === 'RANGE') sp.range = val.trim().slice(0, 80) || null;
      else if (tag === 'TARGETAREA') sp.targetArea = val.trim().slice(0, 200) || null;
      else if (tag === 'DURATION') sp.duration = val.trim().slice(0, 120) || null;
      else if (tag === 'SAVEINFO') sp.save = val.trim().slice(0, 120) || null;
      else if (tag === 'SPELLRES') sp.sr = val.trim().slice(0, 80) || null;
    } else if (next.kind === 'feat' || next.kind === 'ability') {
      const f = next as FeatRecord;
      if (tag === 'CATEGORY') f.category = val.trim().slice(0, 60) || f.category;
      else if (tag === 'BENEFIT') f.benefit = cleanDesc(val);
      else if (tag === 'CSKILL') abilityCskills.set(next, parseCskills(val, abilityCskills.get(next) ?? []));
      else if (tag === 'VISION') {
        const v = parseVision(val);
        const cur = abilityVision.get(next) ?? { darkvision: 0, lowLight: false };
        abilityVision.set(next, { darkvision: Math.max(cur.darkvision, v.darkvision), lowLight: cur.lowLight || v.lowLight });
      } else if (tag === 'BONUS' && (/^STAT\|%LIST\|2/i.test(val) || /^ABILITYPOOL\|Ability Bonus\|1/i.test(val))) {
        abilityHasAnyPlusTwo.set(next, true);
      } else if (tag === 'CHOOSE' && /^STAT\|/i.test(val)) {
        abilityHasAnyPlusTwo.set(next, true);
      } else if (tag === 'TEMPLATE') {
        const m = /\bSIZE_([FDTSMLHGC])\b/i.exec(val);
        const sz = m ? SIZE_CODE[m[1]!.toUpperCase()] : undefined;
        if (sz) abilitySize.set(next, sz);
      }
    } else if (next.kind === 'deity') {
      const d = next as DeityRecord;
      if (tag === 'ALIGN') d.alignment = val.trim().slice(0, 10) || null;
      else if (tag === 'DOMAINS') {
        const ds = val.split('|')[0]!.split(',').map((x) => x.trim()).filter((x) => x && x.toUpperCase() !== 'ALL');
        d.domains = [...new Set([...d.domains, ...ds])].slice(0, 20);
      } else if (tag === 'DEITYWEAP') d.favoredWeapon = val.split('|')[0]!.trim().slice(0, 80) || null;
      else if (tag === 'SYMBOL') d.symbol = val.trim().slice(0, 120) || null;
    } else if (next.kind === 'class') {
      const cl = next as ClassRecord;
      if (tag === 'HD') {
        const hd = numOrNull(val);
        if (hd !== null && hd >= 4 && hd <= 12) cl.hd = Math.floor(hd);
      } else if (tag === 'STARTSKILLPTS') {
        const pts = numOrNull(val);
        if (pts !== null && pts >= 0 && pts <= 20) cl.skillRanks = Math.floor(pts);
      } else if (tag === 'CSKILL') {
        cl.classSkills = parseCskills(val, cl.classSkills);
      } else if (tag === 'SPELLSTAT') {
        const st = val.trim().toUpperCase();
        if ((STAT_KEYS as string[]).includes(st)) cl.spellStat = st as StatKey;
      } else if (tag === 'MEMORIZE') {
        const m = val.trim().toUpperCase();
        if (m === 'YES') cl.memorize = true;
        else if (m === 'NO') cl.memorize = false;
      } else if (tag === 'SPELLTYPE' || (tag === 'FACT' && /^SpellType\|/i.test(val))) {
        const st = (tag === 'FACT' ? val.split('|')[1] ?? '' : val).trim().toLowerCase();
        if (st === 'arcane' || st === 'divine' || st === 'psychic') cl.spellType = st;
      }
    } else if (next.kind === 'race') {
      const r = next as RaceRecord;
      if (tag === 'SIZE') {
        const sz = SIZE_CODE[val.trim().toUpperCase()];
        if (sz) r.size = sz;
      } else if (tag === 'FACT' && /^BaseSize\|/i.test(val)) {
        const sz = SIZE_CODE[(val.split('|')[1] ?? '').trim().toUpperCase()];
        if (sz) r.size = sz;
      } else if (tag === 'MOVE') {
        const m = /Walk\s*,\s*(\d+)/i.exec(val);
        if (m) r.speed = Math.max(0, Math.min(200, Number(m[1])));
      } else if (tag === 'VISION') {
        const v = parseVision(val);
        r.darkvision = Math.max(r.darkvision, v.darkvision);
        r.lowLight = r.lowLight || v.lowLight;
      }
    }
  }

  if (next.kind === 'class') {
    const cl = next as ClassRecord;
    if (cl.types.some((t) => /^prestige$/i.test(t))) cl.prestige = true;
    parseClassProgressions(cl, tokens);
  }
  if (next.kind === 'equipment' || next.kind === 'feat' || next.kind === 'ability' || next.kind === 'race') {
    const parsedBonuses = parseStaticBonuses(tokens, next.kind, next.types);
    if (next.kind === 'race') {
      const r = next as RaceRecord;
      for (const b of parsedBonuses) {
        if ((STAT_KEYS as string[]).includes(b.target)) r.abilityMods[b.target as StatKey] = (r.abilityMods[b.target as StatKey] ?? 0) + b.value;
        else if (b.target === 'skill' && b.skill && Object.keys(r.skillBonuses).length < 30) r.skillBonuses[b.skill] = b.value;
      }
    } else if (parsedBonuses.length) {
      const merged = [...(next.bonuses ?? [])];
      const seen = new Set(merged.map((b) => `${b.target}|${b.skill ?? ''}|${b.value}|${b.type}`));
      for (const b of parsedBonuses) {
        const sig = `${b.target}|${b.skill ?? ''}|${b.value}|${b.type}`;
        if (!seen.has(sig) && merged.length < 20) {
          seen.add(sig);
          merged.push(b);
        }
      }
      if (merged.length) next.bonuses = merged;
    }
  }

  if (next.kind === 'equipment') {
    const ac = parseAcBonus(tokens);
    if (ac !== null) (next as EquipmentRecord).acBonus = ac;
    const fx = parseSpellEffectFromTokens(tokens);
    if (fx) (next as EquipmentRecord).spellEffect = fx;
  }
  if ((next.kind === 'feat' || next.kind === 'ability') && prereqToks.length) {
    const pr = formatPrereqs(prereqToks);
    if (pr) (next as FeatRecord).prereqs = pr;
  }
  next.desc = joinDesc(desc);
  if (!next.source.long) next.source.long = defaultSource.long;
  if (!next.source.short) next.source.short = defaultSource.short;
  if (!next.source.campaign) next.source.campaign = defaultSource.campaign;
  return next;
}

function emptyRecord(kind: RulesKind, name: string, source: RulesSource): RulesRecord {
  const base = { kind, key: name.slice(0, 160), name: name.slice(0, 160), source: { ...source }, desc: '', types: [] as string[] };
  switch (kind) {
    case 'equipment':
      return {
        ...base,
        kind: 'equipment',
        cost: null,
        weight: null,
        baseItem: null,
        damage: null,
        critRange: null,
        critMult: null,
        range: null,
        wield: null,
        acBonus: null,
        maxDex: null,
        acp: null,
        asf: null,
        slot: null,
        cl: null,
        aura: null,
        eqmods: [],
        spellEffect: null,
      };
    case 'equipmod':
      return { ...base, kind: 'equipmod', cost: null, itypes: [] };
    case 'spell':
      return {
        ...base,
        kind: 'spell',
        school: null,
        subschool: null,
        descriptors: [],
        classes: {},
        domains: {},
        castTime: null,
        components: null,
        range: null,
        targetArea: null,
        duration: null,
        save: null,
        sr: null,
      };
    case 'feat':
    case 'ability':
      return { ...base, kind, category: kind === 'feat' ? 'FEAT' : 'Special Ability', benefit: '', prereqs: '' };
    case 'deity':
      return { ...base, kind: 'deity', alignment: null, domains: [], favoredWeapon: null, symbol: null };
    case 'domain':
      return { ...base, kind: 'domain' };
    case 'class':
      return {
        ...base,
        kind: 'class',
        hd: null,
        bab: null,
        goodSaves: [],
        prestige: false,
        skillRanks: null,
        classSkills: [],
        spellStat: null,
        spellType: null,
        memorize: null,
      };
    case 'race':
      return {
        ...base,
        kind: 'race',
        size: null,
        speed: null,
        abilityMods: {},
        anyPlusTwo: false,
        steady: false,
        darkvision: 0,
        lowLight: false,
        skillBonuses: {},
      };
  }
}

/** A `.COPY` / `.MOD` / `.FORGET` line, applied after every book's base records load (PCGen order). */
export interface DeferredDirective {
  kind: RulesKind;
  op: 'copy' | 'mod' | 'forget';
  target: string;
  newName?: string;
  rest: string[];
  fileSource: RulesSource;
  /** Whether this directive may change (MOD/FORGET) a record from `campaign`. */
  canModify: (campaign: string) => boolean;
}

export interface ParseLstOptions {
  /** Collect directives here instead of applying them inline. */
  deferred?: DeferredDirective[];
  /** Cross-publisher guard for .MOD/.FORGET (default: allow everything). */
  canModify?: (campaign: string) => boolean;
}

function lookupKey(records: Map<string, RulesRecord>, byName: Map<string, string>, target: string): string | undefined {
  return records.has(target) ? target : byName.get(target.toLowerCase());
}

/** Apply one directive to the record store. Returns a warning when it is refused. */
export function applyDirective(d: DeferredDirective, records: Map<string, RulesRecord>, byName: Map<string, string>): string | null {
  const k = lookupKey(records, byName, d.target);
  if (d.op === 'copy') {
    if (!d.newName) return null;
    const base = k ? records.get(k) : undefined;
    let cloned: RulesRecord;
    if (base) {
      const samePage = base.source.campaign === d.fileSource.campaign && !d.fileSource.page ? base.source.page : d.fileSource.page;
      cloned = { ...(structuredClone(base) as RulesRecord), key: d.newName.slice(0, 160), name: d.newName.slice(0, 160), source: { ...d.fileSource, page: samePage } };
      const parts = descParts.get(base);
      if (parts) descParts.set(cloned, { normal: [...parts.normal], full: [...parts.full], short: [...parts.short] });
    } else cloned = emptyRecord(d.kind, d.newName, d.fileSource);
    const updated = applyFields(d.kind, cloned, d.rest, d.fileSource);
    records.set(updated.key, updated);
    byName.set(updated.name.toLowerCase(), updated.key);
    return null;
  }
  if (!k) return null;
  const existing = records.get(k);
  if (!existing) return null;
  if (!d.canModify(existing.source.campaign)) {
    return `Ignored ${d.target}.${d.op.toUpperCase()} from ${d.fileSource.campaign} (another publisher's record)`;
  }
  if (d.op === 'forget') {
    records.delete(k);
    byName.delete(existing.name.toLowerCase());
    return null;
  }
  const updated = applyFields(d.kind, existing, d.rest, d.fileSource, true);
  records.delete(k);
  records.set(updated.key, updated);
  byName.set(updated.name.toLowerCase(), updated.key);
  return null;
}

/**
 * Parse a single `.lst` file into `records` (keyed by KEY). `.COPY`, `.MOD`
 * and `.FORGET` lines are applied inline, or collected into
 * `opts.deferred` so the builder can apply them after every book loads.
 * A second plain definition of an existing KEY is ignored (first book wins).
 */
export function parseLstContent(
  kind: RulesKind,
  content: string,
  bookSource: RulesSource,
  records: Map<string, RulesRecord>,
  byName: Map<string, string>,
  opts: ParseLstOptions = {},
) {
  let fileSource: RulesSource = { ...bookSource };
  const canModify = opts.canModify ?? (() => true);
  /** Classes in PCGen repeat `CLASS:<Name>` across multiple lines in the same file; track keys opened in this file so subsequent lines merge into them. */
  const classOpenedInFile = new Set<string>();
  const directive = (d: Omit<DeferredDirective, 'kind' | 'fileSource' | 'canModify'>) => {
    const full: DeferredDirective = { ...d, kind, fileSource: { ...fileSource }, canModify };
    if (opts.deferred) opts.deferred.push(full);
    else applyDirective(full, records, byName);
  };

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const tokens = line.split('\t').map((t) => t.trim()).filter(Boolean);
    if (!tokens.length) continue;

    // Header source lines (`SOURCELONG:... \t SOURCESHORT:...`).
    if (/^SOURCE(LONG|SHORT|WEB|DATE|PAGE):/i.test(tokens[0]!)) {
      for (const tok of tokens) {
        const c = tok.indexOf(':');
        if (c === -1) continue;
        const tag = tok.slice(0, c).toUpperCase();
        const val = tok.slice(c + 1).trim();
        if (tag === 'SOURCELONG' && val) fileSource = { ...fileSource, long: val.slice(0, 160) };
        else if (tag === 'SOURCESHORT' && val) fileSource = { ...fileSource, short: val.slice(0, 40) };
        else if (tag === 'SOURCEPAGE') fileSource = { ...fileSource, page: val.slice(0, 40) || null };
      }
      continue;
    }

    let head = tokens[0]!;
    const rest = tokens.slice(1);

    if (kind === 'class') {
      // Level progression lines (`1\tCAST:...`, `2\tABILITY:...`) and SUBCLASS/SUBSTITUTION lines are skipped.
      if (/^\d+$/.test(head) || /^(SUBCLASS|SUBCLASSLEVEL|SUBSTITUTIONCLASS|SUBSTITUTIONLEVEL):/i.test(head)) continue;
      if (/^CLASS:/i.test(head)) head = head.slice(6).trim();
      else continue;
    }

    if (head.endsWith('.FORGET')) {
      directive({ op: 'forget', target: head.slice(0, -'.FORGET'.length).trim(), rest });
      continue;
    }
    // CATEGORY=FEAT|Power Attack.MOD (ability files)
    const catMod = /^CATEGORY=[^|]+\|(.+?)\.MOD$/i.exec(head);
    if (catMod) {
      directive({ op: 'mod', target: catMod[1]!.trim(), rest });
      continue;
    }
    if (head.startsWith('CATEGORY=')) continue;
    if (head.endsWith('.MOD')) {
      directive({ op: 'mod', target: head.slice(0, -'.MOD'.length).trim(), rest });
      continue;
    }
    const copyIdx = head.indexOf('.COPY=');
    if (copyIdx !== -1) {
      const newName = head.slice(copyIdx + '.COPY='.length).trim();
      if (newName) directive({ op: 'copy', target: head.slice(0, copyIdx).trim(), newName, rest });
      continue;
    }

    if (kind === 'class' && classOpenedInFile.has(head)) {
      const existing = records.get(head);
      if (existing) {
        const merged = applyFields(kind, existing, rest, fileSource);
        records.set(merged.key, merged);
        byName.set(merged.name.toLowerCase(), merged.key);
      }
      continue;
    }

    const rec = applyFields(kind, emptyRecord(kind, head, fileSource), rest, fileSource);
    if (records.has(rec.key)) continue;
    records.set(rec.key, rec);
    if (kind === 'class') classOpenedInFile.add(rec.key);
    if (!byName.has(rec.name.toLowerCase())) byName.set(rec.name.toLowerCase(), rec.key);
  }
}

function findPccFiles(rootDir: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile() && e.name.toLowerCase().endsWith('.pcc')) out.push(full);
    }
  };
  walk(rootDir);
  return out.sort();
}

export interface BuildPackResult {
  manifest: RulesManifest;
  outDir: string;
}

/**
 * Build a rules pack from a PCGen data directory (e.g. `data/pcgen/data/pathfinder`)
 * and optional sibling `homebrew/` directory, writing JSON files into `outDir`.
 */
export function buildRulesPack(pcgenDir: string, outDir: string): BuildPackResult {
  const absIn = path.resolve(pcgenDir);
  if (!fs.existsSync(absIn)) throw new Error(`PCGen data folder not found: ${absIn}`);

  const pccPaths = findPccFiles(absIn);
  // Also include a sibling `homebrew/` folder if it exists next to `pathfinder/`.
  const homebrewDir = path.resolve(absIn, '..', 'homebrew');
  const homebrewPccs = new Set<string>();
  if (homebrewDir !== absIn && fs.existsSync(homebrewDir)) {
    for (const p of findPccFiles(homebrewDir)) {
      pccPaths.push(p);
      homebrewPccs.add(p);
    }
  }

  const parsedPccs = new Map<string, ParsedPcc>();
  const warnings: string[] = [];
  for (const p of pccPaths) {
    try {
      parsedPccs.set(p, { ...parsePccFile(p, absIn), homebrew: homebrewPccs.has(p) });
    } catch (e) {
      warnings.push(`Skipped ${path.basename(p)}: ${(e as Error).message}`);
    }
  }

  const stores = Object.fromEntries(RULES_KINDS.map((k) => [k, new Map<string, RulesRecord>()])) as Record<RulesKind, Map<string, RulesRecord>>;
  const nameMaps = Object.fromEntries(RULES_KINDS.map((k) => [k, new Map<string, string>()])) as Record<RulesKind, Map<string, string>>;
  const bookCounts = new Map<string, number>();
  const bookMeta = new Map<string, Omit<RulesBook, 'records'>>();
  const visitedLst = new Set<string>();
  const deferred: DeferredDirective[] = [];
  /** "Paizo Inc." / "Paizo Publishing LLC" -> "paizo". */
  const publisherKey = (p: string) => (/^paizo\b/i.test(p.trim()) ? 'paizo' : p.trim().toLowerCase());
  const publisherOf = (campaign: string) => publisherKey(bookMeta.get(campaign)?.publisher ?? '');

  // Sort Core Rulebook first, then regular standalone books, then PFS / Player-Options variants,
  // and MultiSet meta-bundles last so meta-bundles (e.g. "Pathfinder RPG Core Supplements")
  // never steal .lst ownership from Ultimate Combat / Equipment / Campaign / Intrigue / Magic.
  const tierOf = (p: ParsedPcc): number => {
    const isMulti = /^multiset$/i.test(p.bookType);
    const isVariant = /^pfs\s*~/i.test(p.key) || /~\s*player options only$/i.test(p.key);
    const isCore = !isMulti && !isVariant && (/^core rulebook$/i.test(p.key) || /^core rulebook$/i.test(p.name));
    if (isCore) return 0;
    if (!isMulti && !isVariant) return 1;
    if (!isMulti) return 2;
    return 3;
  };
  const ordered = [...parsedPccs.values()].sort((a, b) => {
    const ta = tierOf(a);
    const tb = tierOf(b);
    if (ta !== tb) return ta - tb;
    return a.key.localeCompare(b.key);
  });

  const processPcc = (pcc: ParsedPcc, book: RulesSource, seenPcc: Set<string>, owner: ParsedPcc) => {
    // Third-party books may not .MOD/.FORGET other publishers' records (their class lists,
    // descriptions and deletions would leak into every campaign); homebrew may change anything.
    const ownPublisher = publisherKey(owner.publisher);
    const canModify = owner.homebrew ? () => true : (campaign: string) => publisherOf(campaign) === ownPublisher;
    if (seenPcc.has(pcc.pccPath)) return;
    seenPcc.add(pcc.pccPath);
    for (const ref of pcc.files) {
      const visitKey = `${ref.kind}:${ref.filePath}`;
      if (visitedLst.has(visitKey)) continue;
      if (!fs.existsSync(ref.filePath)) continue;
      visitedLst.add(visitKey);
      try {
        const before = stores[ref.kind].size;
        const content = fs.readFileSync(ref.filePath, 'utf8');
        parseLstContent(ref.kind, content, book, stores[ref.kind], nameMaps[ref.kind], { deferred, canModify });
        const added = Math.max(0, stores[ref.kind].size - before);
        bookCounts.set(book.campaign, (bookCounts.get(book.campaign) ?? 0) + added);
      } catch (e) {
        warnings.push(`Failed ${path.basename(ref.filePath)}: ${(e as Error).message}`);
      }
    }
    for (const inc of pcc.includes) {
      const sub = parsedPccs.get(inc) ?? (fs.existsSync(inc) ? parsePccFile(inc, absIn) : undefined);
      if (sub) processPcc(sub, book, seenPcc, owner);
    }
  };

  for (const pcc of ordered) {
    // Only register top-level / book-like PCCs that actually own files or have a campaign name.
    const bookSource: RulesSource = { campaign: pcc.key, long: pcc.name, short: pcc.short, page: null };
    if (!bookMeta.has(pcc.key)) {
      bookMeta.set(pcc.key, { key: pcc.key, name: pcc.name, short: pcc.short, publisher: pcc.publisher, bookType: pcc.bookType });
    }
    processPcc(pcc, bookSource, new Set(), pcc);
  }

  // PCGen applies .COPY, then .MOD, then .FORGET once every book has loaded.
  let refused = 0;
  for (const op of ['copy', 'mod', 'forget'] as const) {
    for (const d of deferred) {
      if (d.op !== op) continue;
      const w = applyDirective(d, stores[d.kind], nameMaps[d.kind]);
      if (w) refused++;
    }
  }
  if (refused) warnings.push(`Ignored ${refused} .MOD/.FORGET lines from third-party books that target another publisher's records`);

  // PCGen Pathfinder files list feats inside ABILITY .lst files with CATEGORY:FEAT; split them into `feat`.
  for (const [k, rec] of [...stores.ability.entries()]) {
    const fr = rec as FeatRecord;
    if (fr.category.toUpperCase() === 'FEAT') {
      stores.ability.delete(k);
      stores.feat.set(k, { ...fr, kind: 'feat' });
    }
  }

  // Post-pass 1: PCGen 6 Core classes store CSKILL on `Class Skills ~ <ClassName>` internal ability records.
  for (const rec of stores.class.values()) {
    const cl = rec as ClassRecord;
    if (cl.classSkills.length > 0) continue;
    const csAbility = stores.ability.get(`Class Skills ~ ${cl.name}`) ?? stores.ability.get(`Class Skills ~ ${cl.key}`);
    const cs = csAbility ? abilityCskills.get(csAbility) : undefined;
    if (cs?.length) cl.classSkills = cs.slice(0, 40);
  }

  // Post-pass 2: PCGen 6 `core_essentials` races store ability mods, vision, steady movement, and racial skill
  // defaults in sibling `<Race> ~ ...` ability records. Merge those cleanly onto each RaceRecord.
  const raceDefaultSkills = new Map<string, Record<string, number>>();
  for (const rec of stores.ability.values()) {
    if (!rec.bonuses?.length) continue;
    const defType = rec.types.find((t) => / Racial Default$/i.test(t));
    if (!defType) continue;
    const raceKey = defType.replace(/\s+Racial Default$/i, '').trim().toLowerCase();
    const map = raceDefaultSkills.get(raceKey) ?? {};
    for (const b of rec.bonuses) {
      if (b.target === 'skill' && b.skill && b.type === 'racial' && Object.keys(map).length < 30) {
        map[b.skill] = b.value;
      }
    }
    if (Object.keys(map).length) raceDefaultSkills.set(raceKey, map);
  }
  for (const rec of stores.race.values()) {
    const r = rec as RaceRecord;
    const scoreAb = stores.ability.get(`${r.name} ~ Ability Scores`) ?? stores.ability.get(`${r.key} ~ Ability Scores`);
    if (scoreAb) {
      if (Object.keys(r.abilityMods).length === 0 && scoreAb.bonuses?.length) {
        for (const b of scoreAb.bonuses) {
          if ((STAT_KEYS as string[]).includes(b.target)) r.abilityMods[b.target as StatKey] = b.value;
        }
      }
      if (abilityHasAnyPlusTwo.get(scoreAb) || (Object.keys(r.abilityMods).length === 0 && /\+2\s+(?:bonus\s+)?to\s+one\s+ability/i.test(scoreAb.desc))) {
        r.anyPlusTwo = true;
      }
    }
    const sizeAb = stores.ability.get(`${r.name} ~ Size`) ?? stores.ability.get(`${r.key} ~ Size`);
    const abSz = sizeAb ? abilitySize.get(sizeAb) : undefined;
    if (abSz) r.size = abSz;
    const visAb = stores.ability.get(`${r.name} ~ Vision`) ?? stores.ability.get(`${r.key} ~ Vision`);
    const vis = visAb ? abilityVision.get(visAb) : undefined;
    if (vis) {
      r.darkvision = Math.max(r.darkvision, vis.darkvision);
      r.lowLight = r.lowLight || vis.lowLight;
    }
    const speedAb = stores.ability.get(`${r.name} ~ Speed`) ?? stores.ability.get(`${r.name} ~ Slow and Steady`);
    if (speedAb && /never modified by armor or encumbrance/i.test(speedAb.desc)) r.steady = true;
    const defSkills = raceDefaultSkills.get(r.name.toLowerCase());
    if (defSkills) {
      for (const [sk, val] of Object.entries(defSkills)) {
        if (!(sk in r.skillBonuses) && Object.keys(r.skillBonuses).length < 30) r.skillBonuses[sk] = val;
      }
    }
  }

  // Recompute exact final record count per campaign after .MOD/.FORGET.
  const finalBookCounts = new Map<string, number>();
  for (const k of RULES_KINDS) {
    for (const rec of stores[k].values()) {
      finalBookCounts.set(rec.source.campaign, (finalBookCounts.get(rec.source.campaign) ?? 0) + 1);
    }
  }

  const books: RulesBook[] = [...bookMeta.values()]
    .map((b) => ({ ...b, records: finalBookCounts.get(b.key) ?? 0 }))
    .filter((b) => b.records > 0)
    .sort((a, b) => a.name.localeCompare(b.name));

  const counts = Object.fromEntries(RULES_KINDS.map((k) => [k, stores[k].size])) as Record<RulesKind, number>;
  const manifest: RulesManifest = {
    format: 'vtt-rules-pack',
    version: 1,
    builtAt: Date.now(),
    from: path.basename(absIn),
    counts,
    books,
    warnings: warnings.slice(0, 100),
  };

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  for (const k of RULES_KINDS) {
    fs.writeFileSync(path.join(outDir, `${k}.json`), JSON.stringify([...stores[k].values()]));
  }
  return { manifest, outDir };
}
