/**
 * Archives of Nethys (PF1e, aonprd.com) page parsers (Epic 11). Pure: HTML in,
 * draft record out; the server fetches one page per GM request (see
 * server/src/rules/aon.ts) and the GM reviews the draft before saving it.
 *
 * AoN pages are ASP.NET output with no stable API. The parsers rely on the
 * layout AoN uses for every PF1e display page (verify in audit):
 *   - the item's name in `<h1 class="title">`, a monster's "Name CR x" in `<h2 class="title">`
 *   - labelled fields as `<b>Label</b> value`, separated by `;`, `,` or `<br />`
 *   - sections opened by `<h3 class="framing">Description</h3>` (Defense, Offense...)
 *   - the book as `<b>Source</b> <a ...><i>Core Rulebook pg. 283</i></a>`
 */
import type { CustomRule } from '../entities/rules';
import type { StatAttack } from '../entities/pf1e';
import type { SizeName, StatKey } from '../pf1e/rules';
import { aonPageKind } from './aonUrl';

// ------------------------------------------------------------------ html -> text

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', times: '×', frac12: '½', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', hellip: '…', deg: '°', minus: '−' };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : '';
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Bold labels survive as [[Label]], section headings as "## Heading", line breaks as newlines. */
export function htmlToText(html: string): string {
  let s = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|noscript|head)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<h3\b[^>]*>([\s\S]*?)<\/h3\s*>/gi, '\n## $1\n')
    .replace(/<h2\b[^>]*>([\s\S]*?)<\/h2\s*>/gi, '\n# $1\n')
    .replace(/<h1\b[^>]*>([\s\S]*?)<\/h1\s*>/gi, '\n# $1\n')
    .replace(/<\s*(b|strong)\b[^>]*>([\s\S]*?)<\/\s*\1\s*>/gi, (_, _t, inner: string) => `[[${inner.replace(/<[^>]*>/g, '').trim()}]]`)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|table|ul|ol)\s*>/gi, '\n')
    .replace(/<(p|div|li|tr)\b[^>]*>/gi, '\n')
    .replace(/<[^>]*>/g, '');
  s = decodeEntities(s)
    .replace(/ /g, ' ')
    .replace(/\[\[\s*\]\]/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n');
  return s.trim();
}

/** The text from the first title heading on (drops navigation above it). */
function mainText(html: string): string {
  const start = html.search(/<h1\b[^>]*class="[^"]*title/i);
  return htmlToText(start >= 0 ? html.slice(start) : html);
}

/** Labelled values: "[[Init]] +6; [[Senses]] darkvision 60 ft." -> { Init: '+6', Senses: 'darkvision 60 ft.' } (first occurrence wins). */
export function labelledFields(text: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = /\[\[([^\]]{1,60})\]\]:?\s*([^\n]*?)(?=\[\[|\n|$)/g;
  for (const m of text.matchAll(re)) {
    const label = m[1]!.replace(/:$/, '').trim();
    const value = m[2]!.trim().replace(/^[:]\s*/, '').replace(/[;,]\s*$/, '').trim();
    if (label && !out.has(label.toLowerCase())) out.set(label.toLowerCase(), value);
  }
  return out;
}

/** Text of a "## Heading" section, up to the next heading. */
export function section(text: string, heading: RegExp): string {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => l.startsWith('## ') && heading.test(l.slice(3).trim()));
  if (start === -1) return '';
  const out: string[] = [];
  for (const l of lines.slice(start + 1)) {
    if (l.startsWith('#')) break;
    out.push(l);
  }
  return out.join('\n').replace(/\[\[([^\]]*)\]\]/g, '$1').trim();
}

const plain = (s: string) => s.replace(/\[\[([^\]]*)\]\]/g, '$1').replace(/\s+/g, ' ').trim();

function titleOf(text: string): string {
  const m = /^# (.+)$/m.exec(text);
  return plain(m?.[1] ?? '').replace(/\s*\((?:combat|general|metamagic|teamwork|critical|style|item creation|grit|panache|story|achievement|mythic)\)\s*$/i, '').slice(0, 120);
}

const num = (s: string | undefined | null): number | null => {
  if (!s) return null;
  const m = /[+−-]?\s*\d[\d,]*(?:\.\d+)?/.exec(s.replace(/−/g, '-'));
  if (!m) return null;
  const n = Number(m[0].replace(/[\s,]/g, ''));
  return Number.isFinite(n) ? n : null;
};

const int = (s: string | undefined | null): number | null => {
  const n = num(s);
  return n === null ? null : Math.trunc(n);
};

/** "1,000 gp" -> 1000; "15 sp" -> 1.5. */
export function parsePrice(s: string | undefined): number | null {
  if (!s) return null;
  const m = /([\d,]+(?:\.\d+)?)\s*(pp|gp|sp|cp)\b/i.exec(s);
  if (!m) return null;
  const n = Number(m[1]!.replace(/,/g, ''));
  const unit = m[2]!.toLowerCase();
  return unit === 'pp' ? n * 10 : unit === 'sp' ? n / 10 : unit === 'cp' ? n / 100 : n;
}

/** "PRPG Core Rulebook pg. 283" (the first source listed). */
function sourceOf(fields: Map<string, string>): string {
  return plain(fields.get('source') ?? '').split(/,\s*(?=[A-Z])/)[0]!.slice(0, 160);
}

// ------------------------------------------------------------------ items, spells, feats

export type CustomRuleDraft = Omit<CustomRule, 'id' | 'createdAt' | 'gmOnly'>;

const putFields = (fields: Map<string, string>, labels: [string, string][]): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [label, name] of labels) {
    const v = fields.get(label);
    if (v) out[name] = plain(v).slice(0, 600);
  }
  return out;
};

export function parseAonSpellHtml(html: string, url: string | null = null): CustomRuleDraft {
  const text = mainText(html);
  const f = labelledFields(text);
  const fields = putFields(f, [
    ['school', 'School'],
    ['level', 'Level'],
    ['casting time', 'Casting Time'],
    ['components', 'Components'],
    ['range', 'Range'],
    ['area', 'Area'],
    ['effect', 'Effect'],
    ['target', 'Target'],
    ['targets', 'Target'],
    ['duration', 'Duration'],
    ['saving throw', 'Saving Throw'],
    ['spell resistance', 'Spell Resistance'],
  ]);
  return {
    kind: 'spell',
    name: titleOf(text) || 'Spell',
    source: sourceOf(f),
    aonUrl: url,
    text: section(text, /^description$/i).slice(0, 8000),
    fields,
    cost: null,
    weight: null,
    cl: null,
    slot: null,
    weapon: null,
    armor: null,
  };
}

export function parseAonFeatHtml(html: string, url: string | null = null): CustomRuleDraft {
  const text = mainText(html);
  const f = labelledFields(text);
  const fields = putFields(f, [
    ['prerequisites', 'Prerequisites'],
    ['prerequisite', 'Prerequisites'],
    ['benefit', 'Benefit'],
    ['benefits', 'Benefit'],
    ['normal', 'Normal'],
    ['special', 'Special'],
  ]);
  const heading = /^# (.+)$/m.exec(text)?.[1] ?? '';
  const type = /\(([^)]+)\)\s*$/.exec(plain(heading))?.[1];
  if (type) fields.Type = type.slice(0, 600);
  // The flavour line sits between the title and the first label.
  const afterTitle = text.split('\n').slice(1).join('\n');
  const flavour = plain(afterTitle.split('[[')[0] ?? '');
  const benefit = fields.Benefit ?? '';
  return {
    kind: 'feat',
    name: titleOf(text) || 'Feat',
    source: sourceOf(f),
    aonUrl: url,
    text: [flavour, benefit && `Benefit: ${benefit}`].filter(Boolean).join('\n\n').slice(0, 8000),
    fields,
    cost: null,
    weight: null,
    cl: null,
    slot: null,
    weapon: null,
    armor: null,
  };
}

/** "19-20/x2" -> [19, 2]; "x3" -> [20, 3]. */
export function parseCrit(s: string | undefined): [number, number] {
  const t = (s ?? '').replace(/×/g, 'x');
  const range = /(\d{1,2})\s*[-–]\s*20/.exec(t);
  const mult = /x\s*(\d)/i.exec(t);
  return [range ? Math.max(2, Math.min(20, Number(range[1]))) : 20, mult ? Math.max(2, Math.min(6, Number(mult[1]))) : 2];
}

export function parseAonItemHtml(html: string, url: string | null = null): CustomRuleDraft {
  const text = mainText(html);
  const f = labelledFields(text);
  const fields = putFields(f, [
    ['aura', 'Aura'],
    ['slot', 'Slot'],
    ['price', 'Price'],
    ['cost', 'Cost'],
    ['weight', 'Weight'],
    ['damage', 'Damage'],
    ['critical', 'Critical'],
    ['range', 'Range'],
    ['type', 'Type'],
    ['category', 'Category'],
    ['proficiency', 'Proficiency'],
    ['armor bonus', 'Armor Bonus'],
    ['shield bonus', 'Shield Bonus'],
    ['max dex bonus', 'Max Dex Bonus'],
    ['armor check penalty', 'Armor Check Penalty'],
    ['arcane spell failure chance', 'Arcane Spell Failure'],
    ['requirements', 'Requirements'],
  ]);
  const clText = f.get('cl');
  if (clText) fields.CL = plain(clText);
  const price = parsePrice(f.get('price') ?? f.get('cost'));
  const weight = num(f.get('weight'));
  const cl = int(clText);

  // Weapons: "1d6 (small), 1d8 (medium)"; Armor: "+6", "+2", "-5", "30%".
  let weapon: CustomRule['weapon'] = null;
  const dmg = f.get('damage');
  if (dmg) {
    const medium = /(\d+d\d+)\s*\(\s*m(?:edium)?\s*\)/i.exec(dmg)?.[1] ?? /(\d+d\d+)/.exec(dmg)?.[1];
    if (medium && /^[1-9]\d?d[1-9]\d{0,2}$/.test(medium)) {
      const [critRange, critMult] = parseCrit(f.get('critical'));
      const category = (f.get('category') ?? '').toLowerCase();
      const range = int(f.get('range')) ?? 0;
      const rangedCat = /ranged/.test(category);
      weapon = {
        damage: medium,
        critRange,
        critMult,
        range: Math.max(0, Math.min(1000, range)),
        type: rangedCat ? 'ranged' : 'melee',
        hands: /light/.test(category) ? 'light' : /two/.test(category) ? 'two' : 'one',
        strDamage: rangedCat ? 'none' : 'full',
        finesse: /light/.test(category),
        enhancement: 0,
        masterwork: false,
      };
    }
  }
  let armor: CustomRule['armor'] = null;
  const armorBonus = int(f.get('armor bonus'));
  const shieldBonus = int(f.get('shield bonus'));
  if (armorBonus !== null || shieldBonus !== null) {
    const cat = (f.get('category') ?? f.get('type') ?? '').toLowerCase();
    const shield = shieldBonus !== null || /shield/.test(cat);
    const maxDexText = f.get('max dex bonus');
    armor = {
      kind: shield ? 'shield' : 'armor',
      category: shield ? 'shield' : /heavy/.test(cat) ? 'heavy' : /medium/.test(cat) ? 'medium' : 'light',
      bonus: Math.max(0, Math.min(40, (shield ? shieldBonus : armorBonus) ?? 0)),
      enhancement: 0,
      maxDex: maxDexText && /\d/.test(maxDexText) ? Math.max(0, Math.min(20, int(maxDexText)!)) : null,
      acp: Math.max(-20, Math.min(0, int(f.get('armor check penalty')) ?? 0)),
      asf: Math.max(0, Math.min(100, int(f.get('arcane spell failure chance')) ?? 0)),
    };
  }
  const description = section(text, /^description$/i) || plain(text.split('\n').slice(1).join(' ')).slice(0, 2000);
  return {
    kind: 'equipment',
    name: titleOf(text) || 'Item',
    source: sourceOf(f),
    aonUrl: url,
    text: description.slice(0, 8000),
    fields,
    cost: price === null ? null : Math.min(1e9, price),
    weight: weight === null ? null : Math.max(0, Math.min(100000, weight)),
    cl: cl === null ? null : Math.max(0, Math.min(30, cl)),
    slot: f.get('slot') ? plain(f.get('slot')!).slice(0, 40) : null,
    weapon,
    armor,
  };
}

// ------------------------------------------------------------------ monsters

export type AttackDraft = Omit<StatAttack, 'id'>;

export interface MonsterDraft {
  name: string;
  cr: string;
  xp: number | null;
  alignment: string;
  size: SizeName;
  /** "humanoid (goblinoid)". */
  type: string;
  init: number;
  senses: { darkvision: number; lowLight: boolean; perception: number | null; text: string };
  ac: { total: number; touch: number; flatFooted: number; breakdown: string; natural: number; deflection: number };
  hp: { total: number; hd: string; hitDice: number; die: number };
  saves: { fort: number; ref: number; will: number };
  defensive: string;
  dr: string;
  immune: string;
  resist: string;
  weaknesses: string;
  sr: number | null;
  speed: { base: number; text: string };
  melee: AttackDraft[];
  ranged: AttackDraft[];
  /** Feet. */
  space: number;
  reach: number;
  specialAttacks: string;
  abilities: Record<StatKey, number | null>;
  bab: number;
  cmb: number;
  cmd: number;
  feats: string[];
  skills: { name: string; bonus: number }[];
  languages: string;
  sq: string;
  specialAbilities: string;
  source: string;
  url: string | null;
}

const SIZES: SizeName[] = ['Fine', 'Diminutive', 'Tiny', 'Small', 'Medium', 'Large', 'Huge', 'Gargantuan', 'Colossal'];
const ALIGN = /^(LG|NG|CG|LN|N|CN|LE|NE|CE|Any(?: [a-z]+)?|Always [a-z ]+|Usually [a-z ]+)\s+(Fine|Diminutive|Tiny|Small|Medium|Large|Huge|Gargantuan|Colossal)\s+(.+)$/i;

/** Split on top-level commas and " or " (never inside parentheses). */
function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (ch === '(') depth++;
    if (ch === ')') depth = Math.max(0, depth - 1);
    if (depth === 0 && (ch === ',' || ch === ';')) {
      out.push(cur);
      cur = '';
      continue;
    }
    if (depth === 0 && s.slice(i, i + 4).toLowerCase() === ' or ') {
      out.push(cur);
      cur = '';
      i += 3;
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}

/**
 * "2 claws +7 (1d4+4)", "mwk longsword +8/+3 (1d8+4/19-20)", "bite +7 (1d6+4 plus grab)",
 * "touch +5 (1d6 negative energy)" -> stat attacks ("2 claws" becomes two attacks at +7).
 */
export function parseAttackLine(line: string, mode: 'melee' | 'ranged'): AttackDraft[] {
  const out: AttackDraft[] = [];
  for (const part of splitTop(plain(line).replace(/−/g, '-'))) {
    const m = /^(?:(\d+)\s+)?(.+?)\s+([+-]\d+(?:\/[+-]\d+)*)\s*(?:(?:melee|ranged)\s+)?(?:touch\s+)?\(([^)]*)\)/i.exec(part);
    if (!m) continue;
    const count = Math.max(1, Math.min(8, Number(m[1] ?? 1)));
    const bonuses = m[3]!.split('/').map(Number).filter(Number.isFinite).map((n) => Math.max(-50, Math.min(100, n)));
    const inner = m[4]!;
    const dice = /(\d{1,2})d(\d{1,3})/.exec(inner);
    if (!dice || Number(dice[1]) < 1 || Number(dice[2]) < 1) continue;
    const afterDice = inner.slice(dice.index + dice[0].length);
    const bonus = /^\s*([+-]\s*\d+)/.exec(afterDice);
    const [critRange, critMult] = parseCrit(/\/\s*(\d{1,2}\s*[-–]\s*20(?:\s*\/\s*[x×]\s*\d)?|[x×]\s*\d)/.exec(afterDice)?.[1]);
    const note = /\bplus\s+(.+)$/i.exec(afterDice)?.[0] ?? (afterDice.replace(/^\s*[+-]\s*\d+/, '').replace(/\/[^ ]*/, '').trim() || '');
    const name = m[2]!.replace(/\s+/g, ' ').trim();
    const single = count > 1 ? name.replace(/s$/i, '') : name;
    out.push({
      name: (count > 1 ? `${single} (${count})` : single).slice(0, 60) || 'Attack',
      mode,
      bonuses: count > 1 ? Array.from({ length: count }, () => bonuses[0]!).slice(0, 8) : bonuses.slice(0, 8),
      dice: `${Number(dice[1])}d${Number(dice[2])}`,
      damageBonus: bonus ? Math.max(-50, Math.min(200, Number(bonus[1]!.replace(/\s/g, '')))) : 0,
      critRange,
      critMult,
      note: note.slice(0, 120),
    });
    if (out.length >= 20) break;
  }
  return out;
}

const signedInt = (s: string | undefined, fallback = 0) => int(s) ?? fallback;

/** "Acrobatics +9, Perception +8; Racial Modifiers ..." -> [{ name, bonus }]. */
function parseSkills(s: string): { name: string; bonus: number }[] {
  const out: { name: string; bonus: number }[] = [];
  for (const part of splitTop(plain(s))) {
    const m = /^(.+?)\s+([+-]\d+)\b/.exec(part.replace(/−/g, '-'));
    if (m) out.push({ name: m[1]!.trim().slice(0, 80), bonus: Number(m[2]) });
  }
  return out.slice(0, 60);
}

export function parseAonMonsterHtml(html: string, url: string | null = null): MonsterDraft {
  const start = html.search(/<h2\b[^>]*class="[^"]*title/i);
  const text = htmlToText(start >= 0 ? html.slice(start) : html);
  const lines = text.split('\n');
  const head = plain(lines.find((l) => l.startsWith('# ')) ?? '').replace(/^#\s*/, '');
  const crMatch = /^(.+?)\s+CR\s+([\d/]+)/i.exec(head);
  const f = labelledFields(text);
  const alignLine = lines.map(plain).find((l) => ALIGN.test(l));
  const align = alignLine ? ALIGN.exec(alignLine)! : null;
  const size = (SIZES.find((s) => s.toLowerCase() === align?.[2]?.toLowerCase()) ?? 'Medium') as SizeName;

  // Defense
  const acText = f.get('ac') ?? '';
  const acParts = /([+-]?\d+)\s*,\s*touch\s*([+-]?\d+)\s*,\s*flat-footed\s*([+-]?\d+)/i.exec(acText);
  const breakdown = /\(([^)]*)\)/.exec(acText)?.[1] ?? '';
  const typed = (type: string) => int(new RegExp(`([+-]\\d+)\\s+${type}\\b`, 'i').exec(breakdown)?.[1]) ?? 0;
  const hpText = f.get('hp') ?? '';
  const hdExpr = /\(([^)]*\d+d\d+[^)]*)\)/.exec(hpText)?.[1] ?? '';
  const hdDice = [...hdExpr.matchAll(/(\d+)\s*(?:HD;\s*)?(\d*)d(\d+)/g)];
  const hitDice = hdDice.reduce((s, m) => s + Number(m[2] || m[1]), 0) || int(/(\d+)\s*HD/i.exec(hpText)?.[1]) || 1;
  const die = Number(hdDice[0]?.[3] ?? 8);

  // Senses: "darkvision 60 ft., low-light vision; Perception +5"
  const senses = plain(f.get('senses') ?? '');
  const perception = int(/perception\s*([+-]?\d+)/i.exec(senses)?.[1] ?? f.get('perception'));
  const darkvision = int(/darkvision\s*(\d+)/i.exec(senses)?.[1]) ?? 0;

  const speedText = plain(f.get('speed') ?? '');
  const ability = (k: string) => {
    const v = f.get(k);
    return v && /\d/.test(v) ? int(v) : null;
  };
  const spaceReach = (k: string) => {
    const v = f.get(k);
    const n = num(v);
    if (n !== null) return Math.max(0, Math.min(100, n));
    if (v && /2[-\s]*1\/2/.test(v)) return 2.5;
    return null;
  };
  const defaultSpace: Record<SizeName, number> = { Fine: 0.5, Diminutive: 1, Tiny: 2.5, Small: 5, Medium: 5, Large: 10, Huge: 15, Gargantuan: 20, Colossal: 30 };

  return {
    name: (crMatch?.[1] ?? titleOf(text) ?? 'Monster').trim().slice(0, 80) || 'Monster',
    cr: crMatch?.[2] ?? '',
    xp: int(f.get('xp')),
    alignment: align?.[1] ?? '',
    size,
    type: (align?.[3] ?? '').trim().slice(0, 120),
    init: signedInt(f.get('init')),
    senses: { darkvision, lowLight: /low-light/i.test(senses), perception, text: senses.slice(0, 300) },
    ac: {
      total: int(acParts?.[1]) ?? int(acText) ?? 10,
      touch: int(acParts?.[2]) ?? 10,
      flatFooted: int(acParts?.[3]) ?? 10,
      breakdown: breakdown.slice(0, 200),
      natural: typed('natural'),
      deflection: typed('deflection'),
    },
    hp: { total: Math.max(1, int(hpText) ?? 1), hd: hdExpr.slice(0, 80), hitDice: Math.max(1, Math.min(60, hitDice)), die: [4, 6, 8, 10, 12].includes(die) ? die : 8 },
    saves: { fort: signedInt(f.get('fort')), ref: signedInt(f.get('ref')), will: signedInt(f.get('will')) },
    defensive: plain(f.get('defensive abilities') ?? '').slice(0, 300),
    dr: plain(f.get('dr') ?? '').slice(0, 120),
    immune: plain(f.get('immune') ?? '').slice(0, 300),
    resist: plain(f.get('resist') ?? '').slice(0, 300),
    weaknesses: plain(f.get('weaknesses') ?? f.get('weakness') ?? '').slice(0, 300),
    sr: int(f.get('sr')),
    speed: { base: int(speedText) ?? 30, text: speedText.slice(0, 200) },
    melee: parseAttackLine(f.get('melee') ?? '', 'melee'),
    ranged: parseAttackLine(f.get('ranged') ?? '', 'ranged'),
    space: spaceReach('space') ?? defaultSpace[size],
    reach: spaceReach('reach') ?? (size === 'Large' || size === 'Huge' ? 10 : 5),
    specialAttacks: plain(f.get('special attacks') ?? '').slice(0, 600),
    abilities: { STR: ability('str'), DEX: ability('dex'), CON: ability('con'), INT: ability('int'), WIS: ability('wis'), CHA: ability('cha') },
    bab: signedInt(f.get('base atk')),
    cmb: signedInt(f.get('cmb')),
    cmd: signedInt(f.get('cmd'), 10),
    feats: splitTop(plain(f.get('feats') ?? '')).map((x) => x.replace(/[B]$/, '').trim().slice(0, 80)).filter(Boolean).slice(0, 60),
    skills: parseSkills(f.get('skills') ?? ''),
    languages: plain(f.get('languages') ?? '').slice(0, 300),
    sq: plain(f.get('sq') ?? '').slice(0, 600),
    specialAbilities: section(text, /^special abilities$/i).slice(0, 6000),
    source: sourceOf(f),
    url,
  };
}

export type AonDraft = { kind: 'monster'; monster: MonsterDraft } | { kind: 'rule'; rule: CustomRuleDraft };

/** Parse a fetched page with the parser for its kind. */
export function parseAonPage(html: string, url: string): AonDraft {
  switch (aonPageKind(url)) {
    case 'monster':
      return { kind: 'monster', monster: parseAonMonsterHtml(html, url) };
    case 'spell':
      return { kind: 'rule', rule: parseAonSpellHtml(html, url) };
    case 'feat':
      return { kind: 'rule', rule: parseAonFeatHtml(html, url) };
    default:
      return { kind: 'rule', rule: parseAonItemHtml(html, url) };
  }
}
