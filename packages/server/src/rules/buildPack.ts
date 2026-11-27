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
  RULES_KINDS,
  type DeityRecord,
  type EquipmentRecord,
  type EquipmodRecord,
  type FeatRecord,
  type RulesBook,
  type RulesKind,
  type RulesManifest,
  type RulesRecord,
  type RulesSource,
  type SpellRecord,
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
}

const PCC_KIND_TAG: Record<string, RulesKind> = {
  EQUIPMENT: 'equipment',
  EQUIPMOD: 'equipmod',
  SPELL: 'spell',
  FEAT: 'feat',
  ABILITY: 'ability',
  DEITY: 'deity',
  DOMAIN: 'domain',
};

function cleanDesc(raw: string): string {
  // Strip trailing formula args after `|` in DESC:foo|%1|VAR and collapse placeholders.
  const first = raw.split('|')[0] ?? raw;
  return first
    .replace(/&nl;/gi, '\n')
    .replace(/&pipe;/gi, '|')
    .replace(/%\d+/g, 'X')
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
    const rel = ref.slice(2);
    const direct = path.resolve(dataRoot, rel);
    if (fs.existsSync(direct)) return direct;
    // If dataRoot is already `.../data/pathfinder`, try its parent `.../data`.
    const parent = path.resolve(dataRoot, '..', rel);
    if (fs.existsSync(parent)) return parent;
    return direct;
  }
  return path.resolve(pccDir, ref);
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
    } else if (tag === 'PREATT') {
      parts.push(`BAB +${val}`);
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
    const m = /(?:SPL_CHRG|POTION|SCROLL|WAND)\|([^|\]]+)\|(\d+)\|(\d+)/i.exec(t);
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

function applyFields(_kind: RulesKind, rec: RulesRecord, tokens: string[], defaultSource: RulesSource): RulesRecord {
  const next = { ...rec, source: { ...rec.source }, types: [...rec.types] } as RulesRecord;
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
    } else if (tag === 'SOURCELONG') next.source.long = val.trim().slice(0, 160);
    else if (tag === 'SOURCESHORT') next.source.short = val.trim().slice(0, 40);
    else if (tag === 'SOURCEPAGE') next.source.page = val.trim().slice(0, 40) || null;
    else if (tag === 'DESC') next.desc = cleanDesc(val);
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
      if (tag === 'SCHOOL') sp.school = val.trim().slice(0, 60) || null;
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
    } else if (next.kind === 'deity') {
      const d = next as DeityRecord;
      if (tag === 'ALIGN') d.alignment = val.trim().slice(0, 10) || null;
      else if (tag === 'DOMAINS') {
        const ds = val.split('|')[0]!.split(',').map((x) => x.trim()).filter((x) => x && x.toUpperCase() !== 'ALL');
        d.domains = [...new Set([...d.domains, ...ds])].slice(0, 20);
      } else if (tag === 'DEITYWEAP') d.favoredWeapon = val.split('|')[0]!.trim().slice(0, 80) || null;
      else if (tag === 'SYMBOL') d.symbol = val.trim().slice(0, 120) || null;
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
  }
}

/**
 * Parse a single `.lst` file into `records` (keyed by KEY), applying `.COPY`,
 * `.MOD`, and `.FORGET` directives.
 */
export function parseLstContent(
  kind: RulesKind,
  content: string,
  bookSource: RulesSource,
  records: Map<string, RulesRecord>,
  byName: Map<string, string>,
) {
  let fileSource: RulesSource = { ...bookSource };

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

    const head = tokens[0]!;
    const rest = tokens.slice(1);

    // .FORGET
    if (head.endsWith('.FORGET')) {
      const target = head.slice(0, -'.FORGET'.length).trim();
      const k = records.has(target) ? target : byName.get(target.toLowerCase());
      if (k) {
        const old = records.get(k);
        records.delete(k);
        if (old) byName.delete(old.name.toLowerCase());
      }
      continue;
    }

    // .MOD
    if (head.endsWith('.MOD')) {
      const target = head.slice(0, -'.MOD'.length).trim();
      const k = records.has(target) ? target : byName.get(target.toLowerCase());
      if (!k) continue;
      const existing = records.get(k);
      if (!existing) continue;
      const updated = applyFields(kind, existing, rest, fileSource);
      // Keep original key unless KEY explicitly changed.
      records.delete(k);
      records.set(updated.key, updated);
      byName.set(updated.name.toLowerCase(), updated.key);
      continue;
    }

    // .COPY=<NewName>
    const copyIdx = head.indexOf('.COPY=');
    if (copyIdx !== -1) {
      const origTarget = head.slice(0, copyIdx).trim();
      const newName = head.slice(copyIdx + '.COPY='.length).trim();
      if (!newName) continue;
      const origKey = records.has(origTarget) ? origTarget : byName.get(origTarget.toLowerCase());
      const base = origKey ? records.get(origKey) : undefined;
      const cloned: RulesRecord = base
        ? { ...(structuredClone(base) as RulesRecord), key: newName.slice(0, 160), name: newName.slice(0, 160), source: { ...fileSource } }
        : emptyRecord(kind, newName, fileSource);
      const updated = applyFields(kind, cloned, rest, fileSource);
      records.set(updated.key, updated);
      byName.set(updated.name.toLowerCase(), updated.key);
      continue;
    }

    // Skip CATEGORY=foo|bar.MOD style internal ability mod headers that don't define a record name.
    if (head.startsWith('CATEGORY=')) {
      const modMatch = /^CATEGORY=[^|]+\|(.+?)\.MOD$/i.exec(head);
      if (modMatch) {
        const target = modMatch[1]!.trim();
        const k = records.has(target) ? target : byName.get(target.toLowerCase());
        if (k) {
          const existing = records.get(k)!;
          const updated = applyFields(kind, existing, rest, fileSource);
          records.set(updated.key, updated);
          byName.set(updated.name.toLowerCase(), updated.key);
        }
      }
      continue;
    }

    const base = emptyRecord(kind, head, fileSource);
    const rec = applyFields(kind, base, rest, fileSource);
    records.set(rec.key, rec);
    byName.set(rec.name.toLowerCase(), rec.key);
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
  if (homebrewDir !== absIn && fs.existsSync(homebrewDir)) {
    pccPaths.push(...findPccFiles(homebrewDir));
  }

  const parsedPccs = new Map<string, ParsedPcc>();
  const warnings: string[] = [];
  for (const p of pccPaths) {
    try {
      parsedPccs.set(p, parsePccFile(p, absIn));
    } catch (e) {
      warnings.push(`Skipped ${path.basename(p)}: ${(e as Error).message}`);
    }
  }

  const stores = Object.fromEntries(RULES_KINDS.map((k) => [k, new Map<string, RulesRecord>()])) as Record<RulesKind, Map<string, RulesRecord>>;
  const nameMaps = Object.fromEntries(RULES_KINDS.map((k) => [k, new Map<string, string>()])) as Record<RulesKind, Map<string, string>>;
  const bookCounts = new Map<string, number>();
  const bookMeta = new Map<string, Omit<RulesBook, 'records'>>();
  const visitedLst = new Set<string>();

  // Sort Core Rulebook first so `.MOD` / `.COPY` / `.FORGET` from supplements apply on top of Core.
  const ordered = [...parsedPccs.values()].sort((a, b) => {
    const aCore = /core rulebook/i.test(a.key) || /core rulebook/i.test(a.name) ? 0 : 1;
    const bCore = /core rulebook/i.test(b.key) || /core rulebook/i.test(b.name) ? 0 : 1;
    if (aCore !== bCore) return aCore - bCore;
    return a.key.localeCompare(b.key);
  });

  const processPcc = (pcc: ParsedPcc, book: RulesSource, seenPcc: Set<string>) => {
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
        parseLstContent(ref.kind, content, book, stores[ref.kind], nameMaps[ref.kind]);
        const added = Math.max(0, stores[ref.kind].size - before);
        bookCounts.set(book.campaign, (bookCounts.get(book.campaign) ?? 0) + added);
      } catch (e) {
        warnings.push(`Failed ${path.basename(ref.filePath)}: ${(e as Error).message}`);
      }
    }
    for (const inc of pcc.includes) {
      const sub = parsedPccs.get(inc) ?? (fs.existsSync(inc) ? parsePccFile(inc, absIn) : undefined);
      if (sub) processPcc(sub, book, seenPcc);
    }
  };

  for (const pcc of ordered) {
    // Only register top-level / book-like PCCs that actually own files or have a campaign name.
    const bookSource: RulesSource = { campaign: pcc.key, long: pcc.name, short: pcc.short, page: null };
    if (!bookMeta.has(pcc.key)) {
      bookMeta.set(pcc.key, { key: pcc.key, name: pcc.name, short: pcc.short, publisher: pcc.publisher, bookType: pcc.bookType });
    }
    processPcc(pcc, bookSource, new Set());
  }

  // PCGen Pathfinder files list feats inside ABILITY .lst files with CATEGORY:FEAT; split them into `feat`.
  for (const [k, rec] of [...stores.ability.entries()]) {
    const fr = rec as FeatRecord;
    if (fr.category.toUpperCase() === 'FEAT') {
      stores.ability.delete(k);
      stores.feat.set(k, { ...fr, kind: 'feat' });
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
