#!/usr/bin/env node
/**
 * Fast offline lookup over PCGen's PF1e .lst data in ./data/pcgen/data/pathfinder.
 *
 * Usage:
 *   node .claude/skills/pf1e-rules-check/scripts/pcgen-lookup.mjs <kind> <query> [--all] [--limit=N]
 *
 * Kinds:
 *   class | race | spell | feat | ability | equip | equipmod | skill | any
 *
 * Examples:
 *   node .claude/skills/pf1e-rules-check/scripts/pcgen-lookup.mjs class "Bloodrager"
 *   node .claude/skills/pf1e-rules-check/scripts/pcgen-lookup.mjs spell "Invisibility (Greater)"
 *   node .claude/skills/pf1e-rules-check/scripts/pcgen-lookup.mjs race "Tengu"
 *   node .claude/skills/pf1e-rules-check/scripts/pcgen-lookup.mjs feat "Piranha Strike"
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT_CANDIDATES = [
  process.env.PCGEN_DATA_DIR,
  path.resolve(process.cwd(), 'data/pcgen/data/pathfinder'),
  path.resolve(process.cwd(), 'data/pcgen/pathfinder'),
].filter(Boolean);

const KIND_PATTERNS = {
  class: /_classes.*\.lst$/i,
  race: /_races.*\.lst$/i,
  spell: /_spells.*\.lst$/i,
  feat: /_feats.*\.lst$/i,
  ability: /_abilities.*\.lst$/i,
  equip: /_equip(?!mods).*\.lst$/i,
  equipmod: /_equipmods.*\.lst$/i,
  skill: /_skills.*\.lst$/i,
  any: /\.lst$/i,
};

const args = process.argv.slice(2);
const flags = args.filter((a) => a.startsWith('--'));
const positional = args.filter((a) => !a.startsWith('--'));
const [rawKind, ...queryParts] = positional;
const kind = (rawKind ?? '').toLowerCase();
const query = queryParts.join(' ').trim();
const includeThirdParty = flags.includes('--all');
const limitFlag = flags.find((f) => f.startsWith('--limit='));
const limit = limitFlag ? Math.max(1, Math.min(200, Number(limitFlag.split('=')[1]) || 25)) : 25;

if (!kind || !KIND_PATTERNS[kind] || !query) {
  console.error('Usage: node pcgen-lookup.mjs <class|race|spell|feat|ability|equip|equipmod|skill|any> <query> [--all] [--limit=N]');
  process.exit(1);
}

const dataRoot = ROOT_CANDIDATES.find((d) => fs.existsSync(d));
if (!dataRoot) {
  console.error('PCGen PF1e data directory not found. Expected ./data/pcgen/data/pathfinder (or set PCGEN_DATA_DIR).');
  process.exit(1);
}

const searchRoot = !includeThirdParty && fs.existsSync(path.join(dataRoot, 'paizo')) ? path.join(dataRoot, 'paizo') : dataRoot;
const fileRe = KIND_PATTERNS[kind];
const qLower = query.toLowerCase();
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const qNorm = norm(query);

function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(full, out);
    else if (ent.isFile() && fileRe.test(ent.name)) out.push(full);
  }
  return out;
}

const files = walk(searchRoot).sort((a, b) => {
  // Prioritize Core Rulebook, then Paizo hardcovers (roleplaying_game/), then companions/APs.
  const rank = (p) => (p.includes('/core_rulebook/') ? 0 : p.includes('/roleplaying_game/') ? 1 : 2);
  return rank(a) - rank(b) || a.localeCompare(b);
});

const exact = [];
const exactMods = [];
const partial = [];

for (const file of files) {
  const rel = path.relative(dataRoot, file);
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line || line.startsWith('#') || line.startsWith('SOURCELONG:')) continue;

    if (kind === 'class') {
      if (!line.startsWith('CLASS:')) continue;
      const rawHead = line.split('\t')[0].slice(6).trim();
      const isMod = /\.(MOD|COPY=.*|FORGET)$/.test(rawHead);
      const head = rawHead.replace(/\.(MOD|COPY=.*|FORGET)$/, '').trim();
      const isExact = head.toLowerCase() === qLower || norm(head) === qNorm;
      const isPartial = !isExact && (head.toLowerCase().includes(qLower) || norm(head).includes(qNorm));
      if (!isExact && !isPartial) continue;
      // Collect following class block lines until next CLASS: or blank separator section.
      const block = [line];
      for (let j = i + 1; j < lines.length && block.length < 40; j++) {
        const next = lines[j];
        if (!next || next.startsWith('#')) continue;
        if (next.startsWith('CLASS:') && !next.startsWith(`CLASS:${head}`)) break;
        if (/^(CLASS:|SUBCLASS:|SUBCLASSLEVEL:|1|2|3|4|5|6|7|8|9|10|11|12|13|14|15|16|17|18|19|20)\b/.test(next)) {
          block.push(next);
        }
      }
      const bucket = isExact ? (isMod ? exactMods : exact) : partial;
      bucket.push({ rel, lineNo: i + 1, text: block.join('\n') });
      continue;
    }

    const rawFirst = line.split('\t')[0].trim();
    const isMod = /\.(MOD|COPY=.*|FORGET)$/.test(rawFirst);
    const firstCol = rawFirst.replace(/\.(MOD|COPY=.*|FORGET)$/, '').trim();
    const keyMatch = /\tKEY:([^\t]+)/.exec(line);
    const keyVal = keyMatch ? keyMatch[1].trim() : '';
    const isExact =
      firstCol.toLowerCase() === qLower ||
      norm(firstCol) === qNorm ||
      (keyVal && (keyVal.toLowerCase() === qLower || norm(keyVal) === qNorm));
    const isPartial =
      !isExact &&
      (firstCol.toLowerCase().includes(qLower) ||
        norm(firstCol).includes(qNorm) ||
        (keyVal && (keyVal.toLowerCase().includes(qLower) || norm(keyVal).includes(qNorm))));

    if (isExact) (isMod ? exactMods : exact).push({ rel, lineNo: i + 1, text: line });
    else if (isPartial && partial.length < limit * 2) partial.push({ rel, lineNo: i + 1, text: line });
  }
}

const results = [...exact, ...exactMods, ...partial].slice(0, limit);
if (!results.length) {
  console.log(`No matches for ${kind} "${query}" under ${path.relative(process.cwd(), searchRoot)}. Try --all to include 3rd-party publishers.`);
  process.exit(0);
}

console.log(`Found ${exact.length} exact (+${exactMods.length} .MOD), ${partial.length} partial matches (showing ${results.length}):\n`);
for (const r of results) {
  console.log(`=== ${r.rel}:${r.lineNo} ===`);
  console.log(r.text);
  console.log('');
}
