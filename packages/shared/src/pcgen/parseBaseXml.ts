/**
 * PCGen XML export (`base.xml` output sheet) reader.
 *
 * A .pcg stores build choices; PCGen's XML export stores the numbers PCGen
 * computed from them (AC, saves, skill totals, attacks...). This reads that
 * export into a small summary the sheet can compare against its own engine.
 *
 * The XML parser is deliberately tiny and safe: no dependencies, no DTD
 * processing, no custom entities (only the five predefined ones and numeric
 * character references are decoded, so there is no entity-expansion / XXE
 * surface), and hard caps on input size, nesting depth and element count.
 */

export interface XmlElement {
  name: string;
  attrs: Record<string, string>;
  children: XmlElement[];
  /** Concatenated direct text (and CDATA) content. */
  text: string;
}

export interface XmlLimits {
  maxChars: number;
  maxDepth: number;
  maxElements: number;
}

export const DEFAULT_XML_LIMITS: XmlLimits = { maxChars: 4_000_000, maxDepth: 64, maxElements: 200_000 };

export class XmlParseError extends Error {}

const PREDEFINED: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

/** Decode predefined entities and numeric character references. Anything else is left as written. */
export function decodeXmlEntities(s: string): string {
  if (!s.includes('&')) return s;
  return s.replace(/&(#x[0-9a-fA-F]{1,6}|#[0-9]{1,7}|[a-zA-Z]{2,4});/g, (m, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return m;
      return String.fromCodePoint(code);
    }
    return PREDEFINED[body] ?? m;
  });
}

const NAME_RE = /^[A-Za-z_:][-A-Za-z0-9_:.]*/;
const ATTR_RE = /([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)')/g;

/** Index of the `>` that closes a tag starting at `from`, skipping quoted attribute values. */
function tagEnd(src: string, from: number): number {
  let quote: string | null = null;
  for (let i = from; i < src.length; i++) {
    const ch = src[i]!;
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '>') return i;
  }
  return -1;
}

/** Parse an XML document into an element tree. Throws XmlParseError on malformed or oversized input. */
export function parseXml(input: string, limits: Partial<XmlLimits> = {}): XmlElement {
  const lim = { ...DEFAULT_XML_LIMITS, ...limits };
  if (input.length > lim.maxChars) throw new XmlParseError(`XML is too large (${input.length} characters)`);
  const src = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const root: XmlElement = { name: '#document', attrs: {}, children: [], text: '' };
  const stack: XmlElement[] = [root];
  let count = 0;
  let i = 0;
  const top = () => stack[stack.length - 1]!;

  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt === -1) {
      top().text += decodeXmlEntities(src.slice(i));
      break;
    }
    if (lt > i) top().text += decodeXmlEntities(src.slice(i, lt));

    if (src.startsWith('<!--', lt)) {
      const end = src.indexOf('-->', lt + 4);
      if (end === -1) throw new XmlParseError('Unterminated comment');
      i = end + 3;
    } else if (src.startsWith('<![CDATA[', lt)) {
      const end = src.indexOf(']]>', lt + 9);
      if (end === -1) throw new XmlParseError('Unterminated CDATA section');
      top().text += src.slice(lt + 9, end);
      i = end + 3;
    } else if (src.startsWith('<?', lt)) {
      const end = src.indexOf('?>', lt + 2);
      if (end === -1) throw new XmlParseError('Unterminated processing instruction');
      i = end + 2;
    } else if (src.startsWith('<!', lt)) {
      // DOCTYPE (possibly with an internal subset): skipped, never interpreted.
      let depth = 0;
      let j = lt + 2;
      for (; j < src.length; j++) {
        const ch = src[j];
        if (ch === '[') depth++;
        else if (ch === ']') depth--;
        else if (ch === '>' && depth <= 0) break;
      }
      if (j >= src.length) throw new XmlParseError('Unterminated declaration');
      i = j + 1;
    } else if (src[lt + 1] === '/') {
      const end = src.indexOf('>', lt + 2);
      if (end === -1) throw new XmlParseError('Unterminated closing tag');
      const name = src.slice(lt + 2, end).trim();
      // Tolerate mismatches: close up to the matching open element, or ignore a stray close tag.
      const at = stack.map((e) => e.name).lastIndexOf(name);
      if (at > 0) stack.length = at;
      i = end + 1;
    } else {
      const end = tagEnd(src, lt + 1);
      if (end === -1) throw new XmlParseError('Unterminated tag');
      let body = src.slice(lt + 1, end);
      const selfClosing = body.endsWith('/');
      if (selfClosing) body = body.slice(0, -1);
      const name = NAME_RE.exec(body)?.[0];
      if (!name) throw new XmlParseError(`Invalid tag at offset ${lt}`);
      if (++count > lim.maxElements) throw new XmlParseError('Too many XML elements');
      const attrs: Record<string, string> = {};
      for (const m of body.slice(name.length).matchAll(ATTR_RE)) {
        if (Object.keys(attrs).length >= 64) break;
        attrs[m[1]!] = decodeXmlEntities(m[3] ?? m[4] ?? '');
      }
      const el: XmlElement = { name, attrs, children: [], text: '' };
      top().children.push(el);
      if (!selfClosing) {
        if (stack.length > lim.maxDepth) throw new XmlParseError('XML is nested too deeply');
        stack.push(el);
      }
      i = end + 1;
    }
  }
  return root;
}

// ------------------------------------------------------------------ tree helpers

const kids = (el: XmlElement | undefined, name: string) => el?.children.filter((c) => c.name === name) ?? [];
const kid = (el: XmlElement | undefined, name: string) => el?.children.find((c) => c.name === name);

/** First element at a slash path ("armor_class/total"). */
function at(el: XmlElement | undefined, path: string): XmlElement | undefined {
  let cur = el;
  for (const part of path.split('/')) cur = kid(cur, part);
  return cur;
}

const MAX_TEXT = 300;
const text = (el: XmlElement | undefined) => (el?.text ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);
const textAt = (el: XmlElement | undefined, path: string) => text(at(el, path));

/** "+5", "-2", "−1", "18", "30 ft." -> number; blank or non-numeric -> null. */
export function parseSignedNumber(s: string | undefined | null): number | null {
  const m = /^\s*([+\-−]?)\s*(\d+(?:\.\d+)?)/.exec(s ?? '');
  if (!m) return null;
  const n = Number(m[2]);
  return m[1] === '-' || m[1] === '−' ? -n : n;
}

const num = (el: XmlElement | undefined, path: string) => parseSignedNumber(textAt(el, path));

// ------------------------------------------------------------------ summary

export interface PcgenXmlAttack {
  name: string;
  toHit: string;
  damage: string;
  critical: string;
  range: string;
}

export interface PcgenXmlSummary {
  name: string;
  playerName: string;
  race: string;
  alignment: string;
  deity: string;
  classes: { name: string; level: number }[];
  bio: { gender: string; age: string; height: string; weight: string; eyes: string; hair: string; skin: string; handed: string; region: string; description: string };
  abilities: { key: string; score: number | null; mod: number | null }[];
  hp: number | null;
  ac: { total: number | null; touch: number | null; flatFooted: number | null };
  initiative: number | null;
  bab: number | null;
  cmb: number | null;
  cmd: number | null;
  saves: { fort: number | null; ref: number | null; will: number | null };
  speed: number | null;
  skills: { name: string; total: number | null; ranks: number | null }[];
  attacks: PcgenXmlAttack[];
  spells: { className: string; casterLevel: number | null; levels: { level: number; spells: string[] }[] }[];
  warnings: string[];
}

const MAX_SKILLS = 400;
const MAX_ATTACKS = 100;
const MAX_SPELLS = 2000;

function readAttack(w: XmlElement, fallbackName: string): PcgenXmlAttack {
  const common = kid(w, 'common') ?? w;
  const name = textAt(common, 'name/output') || textAt(common, 'name/short') || textAt(common, 'name') || fallbackName;
  const critRange = textAt(common, 'critical/range');
  const critMult = textAt(common, 'critical/multiplier');
  const critical = critRange || critMult ? `${critRange}${critMult ? `/×${critMult.replace(/^x/i, '')}` : ''}` : textAt(common, 'critical');
  return {
    name,
    toHit: textAt(common, 'to_hit/total_hit') || textAt(common, 'total') || textAt(w, 'total'),
    damage: textAt(common, 'damage') || textAt(w, 'damage'),
    critical,
    range: textAt(common, 'range'),
  };
}

/** Read the summary out of a parsed PCGen XML export. */
export function summarizePcgenXml(doc: XmlElement): PcgenXmlSummary {
  const ch = kid(doc, 'character');
  const warnings: string[] = [];
  if (!ch) throw new XmlParseError('Not a PCGen XML export (no <character> element)');
  const basics = kid(ch, 'basics');
  if (!basics) warnings.push('No <basics> section');

  const classes = kids(kid(basics, 'classes'), 'class')
    .map((c) => ({ name: textAt(c, 'name'), level: Math.max(0, Math.round(num(c, 'level') ?? 0)) }))
    .filter((c) => c.name)
    .slice(0, 40);

  const abilities = kids(kid(ch, 'abilities'), 'ability')
    .map((a) => ({ key: (textAt(a, 'name/short') || textAt(a, 'name')).toUpperCase().slice(0, 10), score: num(a, 'score'), mod: num(a, 'modifier') }))
    .filter((a) => a.key)
    .slice(0, 12);

  const saves: PcgenXmlSummary['saves'] = { fort: null, ref: null, will: null };
  for (const s of kids(kid(ch, 'saving_throws'), 'saving_throw')) {
    const key = (textAt(s, 'name/short') || textAt(s, 'name/long')).toLowerCase();
    const total = num(s, 'total');
    if (/^fort/.test(key)) saves.fort = total;
    else if (/^ref/.test(key)) saves.ref = total;
    else if (/^will/.test(key)) saves.will = total;
  }

  const attack = kid(ch, 'attack');
  const cmbEl = kid(attack, 'cmb');
  const moves = kids(kid(basics, 'move'), 'move');
  const walk = moves.find((m) => /^walk$/i.test(textAt(m, 'name'))) ?? moves[0];

  const skills = kids(kid(ch, 'skills'), 'skill')
    .slice(0, MAX_SKILLS)
    .map((s) => ({ name: textAt(s, 'name').slice(0, 80), total: num(s, 'skill_mod'), ranks: num(s, 'ranks') }))
    .filter((s) => s.name);

  const weapons = kid(ch, 'weapons');
  const attacks: PcgenXmlAttack[] = [];
  const unarmed = kid(weapons, 'unarmed');
  if (unarmed) attacks.push(readAttack(unarmed, 'Unarmed strike'));
  for (const w of kids(weapons, 'weapon')) {
    if (attacks.length >= MAX_ATTACKS) break;
    attacks.push(readAttack(w, 'Weapon'));
  }
  for (const w of kids(weapons, 'naturalattack')) {
    if (attacks.length >= MAX_ATTACKS) break;
    attacks.push(readAttack(w, 'Natural attack'));
  }

  let spellCount = 0;
  const spells: PcgenXmlSummary['spells'] = [];
  for (const c of kids(at(ch, 'spells/known_spells'), 'class')) {
    const levels: { level: number; spells: string[] }[] = [];
    for (const l of kids(c, 'level')) {
      const names: string[] = [];
      for (const s of kids(l, 'spell')) {
        if (spellCount >= MAX_SPELLS) break;
        const n = textAt(s, 'name');
        if (n) {
          names.push(n.slice(0, 120));
          spellCount++;
        }
      }
      if (names.length) levels.push({ level: Math.max(0, Math.min(9, parseSignedNumber(l.attrs.number) ?? 0)), spells: names });
    }
    const className = (c.attrs.spelllistclass ?? '').trim().slice(0, 80);
    if (className && levels.length) spells.push({ className, casterLevel: parseSignedNumber(c.attrs.spellcasterlevel), levels });
  }

  return {
    name: textAt(basics, 'name'),
    playerName: textAt(basics, 'playername'),
    race: kids(basics, 'race').map(text).find(Boolean) ?? '',
    alignment: textAt(basics, 'alignment/long') || textAt(basics, 'alignment'),
    deity: textAt(basics, 'deity/name'),
    classes,
    bio: {
      gender: textAt(basics, 'gender/long') || textAt(basics, 'gender'),
      age: textAt(basics, 'age'),
      height: textAt(basics, 'height/total'),
      weight: textAt(basics, 'weight/weight_unit'),
      eyes: textAt(basics, 'eyes/color'),
      hair: textAt(basics, 'hair/color'),
      skin: textAt(basics, 'skin/color'),
      handed: textAt(basics, 'handed'),
      region: textAt(basics, 'region'),
      description: textAt(basics, 'description'),
    },
    abilities,
    hp: num(ch, 'hit_points/points'),
    ac: { total: num(ch, 'armor_class/total'), touch: num(ch, 'armor_class/touch'), flatFooted: num(ch, 'armor_class/flat') },
    initiative: num(ch, 'initiative/total'),
    bab: num(basics, 'bab') ?? num(attack, 'melee/bab'),
    cmb: cmbEl ? num(cmbEl, 'total') : num(attack, 'grapple/total'),
    cmd: cmbEl ? num(cmbEl, 'defense') : null,
    saves,
    speed: walk ? parseSignedNumber(textAt(walk, 'rate')) : null,
    skills,
    attacks,
    spells,
    warnings,
  };
}

/** Parse a PCGen XML export file's text into a summary. Throws XmlParseError with a readable message. */
export function parseBaseXml(input: string, limits?: Partial<XmlLimits>): PcgenXmlSummary {
  return summarizePcgenXml(parseXml(input, limits));
}

// ------------------------------------------------------------------ compare

export interface XmlCompareRow {
  label: string;
  pcgen: number | null;
  vtt: number;
  match: boolean;
}

/** The VTT numbers a PCGen XML summary can be checked against (a subset of CharacterStats). */
export interface ComparableStats {
  abilities: Record<string, { score: number; mod: number }>;
  hp: { total: number };
  ac: { normal: { total: number }; touch: { total: number }; flatFooted: { total: number } };
  initiative: { total: number };
  bab: { total: number };
  cmb: { total: number };
  cmd: { total: number };
  saves: Record<'fort' | 'ref' | 'will', { total: number }>;
  speed: { total: number };
}

/** Side-by-side PCGen vs VTT numbers. Rows PCGen didn't export are left out. */
export function comparePcgenXml(summary: PcgenXmlSummary, stats: ComparableStats, skillTotals?: Map<string, number>): XmlCompareRow[] {
  const rows: XmlCompareRow[] = [];
  const add = (label: string, pcgen: number | null, vtt: number) => {
    if (pcgen !== null) rows.push({ label, pcgen, vtt, match: pcgen === vtt });
  };
  for (const a of summary.abilities) {
    const v = stats.abilities[a.key];
    if (v) add(a.key, a.score, v.score);
  }
  add('Hit points', summary.hp, stats.hp.total);
  add('AC', summary.ac.total, stats.ac.normal.total);
  add('Touch AC', summary.ac.touch, stats.ac.touch.total);
  add('Flat-footed AC', summary.ac.flatFooted, stats.ac.flatFooted.total);
  add('Fortitude', summary.saves.fort, stats.saves.fort.total);
  add('Reflex', summary.saves.ref, stats.saves.ref.total);
  add('Will', summary.saves.will, stats.saves.will.total);
  add('BAB', summary.bab, stats.bab.total);
  add('CMB', summary.cmb, stats.cmb.total);
  add('CMD', summary.cmd, stats.cmd.total);
  add('Initiative', summary.initiative, stats.initiative.total);
  add('Speed', summary.speed, stats.speed.total);
  if (skillTotals) {
    const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
    const vtt = new Map([...skillTotals].map(([k, v]) => [norm(k), v]));
    for (const s of summary.skills) {
      const v = vtt.get(norm(s.name));
      if (v !== undefined) add(s.name, s.total, v);
    }
  }
  return rows;
}
