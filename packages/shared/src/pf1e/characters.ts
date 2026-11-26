/** Pure helpers for PF1e characters (shared by client UI and server tests). */
import { EMPTY_RUNTIME, type Character } from '../entities/pf1e';
import type { PcgenCharacter } from '../pcgen/schema';

/** Character name from a parsed file, with a sensible fallback. */
export function buildName(build: PcgenCharacter, fallback = 'Unnamed character'): string {
  const name = (build.bio.name ?? build.bio.tabName ?? '').trim();
  return (name || fallback).slice(0, 80);
}

/** "Fighter 2 / Wizard 1" */
export function classSummary(build: PcgenCharacter): string {
  return build.classes.map((c) => `${c.name}${c.subClass ? ` (${c.subClass})` : ''} ${c.level}`).join(' / ') || 'No classes';
}

export function totalLevel(build: PcgenCharacter): number {
  return build.classes.reduce((s, c) => s + c.level, 0);
}

function fileFallbackName(fileName: string): string {
  return fileName.replace(/\.pcg$/i, '').trim() || 'Unnamed character';
}

/** A new character from a freshly parsed .pcg file. */
export function createCharacterFromPcg(
  build: PcgenCharacter,
  opts: { id: string; ownerId: string | null; fileName: string; importedBy: string; now: number },
): Character {
  return {
    id: opts.id,
    name: buildName(build, fileFallbackName(opts.fileName)),
    ownerId: opts.ownerId,
    tokenId: null,
    shared: false,
    source: { kind: 'pcgen', fileName: opts.fileName.slice(0, 255), importedAt: opts.now, importedBy: opts.importedBy },
    build,
    runtime: structuredClone(EMPTY_RUNTIME),
    createdAt: opts.now,
    updatedAt: opts.now,
  };
}

/**
 * Apply a re-imported build to an existing character. Build data is replaced;
 * id, owner, token link, sharing and runtime state are kept. A name the user
 * customized in the VTT is kept too.
 */
export function mergeReimport(
  existing: Character,
  build: PcgenCharacter,
  opts: { fileName: string; importedBy: string; now: number },
): Character {
  const prevImportedName = buildName(existing.build, fileFallbackName(existing.source.fileName));
  const nameWasImported = existing.name === prevImportedName;
  return {
    ...existing,
    name: nameWasImported ? buildName(build, existing.name) : existing.name,
    build,
    source: { kind: 'pcgen', fileName: opts.fileName.slice(0, 255), importedAt: opts.now, importedBy: opts.importedBy },
    updatedAt: opts.now,
  };
}

// ------------------------------------------------------------------ diff

export interface BuildChange {
  section: string;
  kind: 'changed' | 'added' | 'removed';
  text: string;
}

function diffList(section: string, before: Map<string, string>, after: Map<string, string>, out: BuildChange[]) {
  for (const [key, label] of after) {
    if (!before.has(key)) out.push({ section, kind: 'added', text: label });
    else if (before.get(key) !== label) out.push({ section, kind: 'changed', text: `${before.get(key)} → ${label}` });
  }
  for (const [key, label] of before) if (!after.has(key)) out.push({ section, kind: 'removed', text: label });
}

/** Build a key -> label map that counts duplicate entries instead of silently overwriting them. */
function countedMap(entries: [string, string][]): Map<string, string> {
  const counts = new Map<string, { label: string; count: number }>();
  for (const [key, label] of entries) {
    const prev = counts.get(key);
    counts.set(key, { label, count: (prev?.count ?? 0) + 1 });
  }
  const out = new Map<string, string>();
  for (const [key, { label, count }] of counts) out.set(key, count > 1 ? `${label} (×${count})` : label);
  return out;
}

const fmtQty = (name: string, qty: number | null) => (qty !== null && qty !== 1 ? `${name} ×${qty}` : name);

function formatAppliedTo(appliedTo: string[]): string {
  const nonEmpty = appliedTo.filter((s) => s.trim().length > 0);
  if (nonEmpty.length > 0) return ` (${nonEmpty.join(', ')})`;
  if (appliedTo.length > 1) return ` (×${appliedTo.length})`;
  return '';
}

function equipmentMap(items: PcgenCharacter['equipment']): Map<string, string> {
  const totals = new Map<string, { qty: number | null; count: number }>();
  for (const e of items) {
    const prev = totals.get(e.name);
    if (!prev) {
      totals.set(e.name, { qty: e.quantity, count: 1 });
    } else {
      const qty = (prev.qty ?? 1) + (e.quantity ?? 1);
      totals.set(e.name, { qty, count: prev.count + 1 });
    }
  }
  const out = new Map<string, string>();
  for (const [name, { qty }] of totals) out.set(name, fmtQty(name, qty));
  return out;
}

/** Human-readable differences between two builds (for the re-import preview). */
export function diffCharacterBuild(before: PcgenCharacter, after: PcgenCharacter): BuildChange[] {
  const out: BuildChange[] = [];
  const scalar = (section: string, a: unknown, b: unknown) => {
    if ((a ?? '') !== (b ?? '')) out.push({ section, kind: 'changed', text: `${a ?? '—'} → ${b ?? '—'}` });
  };

  scalar('Name', before.bio.name, after.bio.name);
  scalar('Race', before.attributes.race, after.attributes.race);
  scalar('Alignment', before.attributes.alignment, after.attributes.alignment);
  scalar('Deity', before.attributes.deity?.name, after.attributes.deity?.name);
  scalar('Experience', before.experience.xp, after.experience.xp);
  scalar('Money (gp)', before.money.amount, after.money.amount);

  const classLabel = (c: PcgenCharacter['classes'][number]) => `${c.name}${c.subClass ? ` (${c.subClass})` : ''} ${c.level}`;
  diffList(
    'Classes',
    new Map(before.classes.map((c) => [c.name, classLabel(c)])),
    new Map(after.classes.map((c) => [c.name, classLabel(c)])),
    out,
  );
  diffList(
    'Ability scores',
    new Map(Object.entries(before.attributes.stats).map(([k, v]) => [k, `${k} ${v}`])),
    new Map(Object.entries(after.attributes.stats).map(([k, v]) => [k, `${k} ${v}`])),
    out,
  );
  diffList(
    'Skills',
    new Map(before.skills.filter((s) => s.totalRanks > 0).map((s) => [s.name, `${s.name} ${s.totalRanks} ranks`])),
    new Map(after.skills.filter((s) => s.totalRanks > 0).map((s) => [s.name, `${s.name} ${s.totalRanks} ranks`])),
    out,
  );
  const abilityEntries = (b: PcgenCharacter): [string, string][] => [
    ...b.abilities.map(
      (a): [string, string] => [
        `${a.pool}|${a.category}|${a.key}|${a.appliedTo.join(',')}`,
        `${a.key}${formatAppliedTo(a.appliedTo)} [${a.category}]`,
      ],
    ),
    ...b.legacyFeats.map((f): [string, string] => [`legacy-feat|${f}`, `${f} [FEAT]`]),
    ...b.virtualFeats.map((f): [string, string] => [`virtual-feat|${f}`, `${f} [VFEAT]`]),
  ];
  diffList('Feats & abilities', countedMap(abilityEntries(before)), countedMap(abilityEntries(after)), out);
  diffList('Equipment', equipmentMap(before.equipment), equipmentMap(after.equipment), out);

  const spellKey = (s: PcgenCharacter['spells']['entries'][number]) =>
    `${s.className ?? ''}|${s.book ?? ''}|${s.spellName}|${s.level ?? ''}|${s.metamagic.join(',')}`;
  const spellLabel = (s: PcgenCharacter['spells']['entries'][number]) => {
    const parts = [s.spellName];
    if (s.level !== null) parts.push(`(level ${s.level})`);
    if (s.times !== null && s.times !== 1) parts.push(`×${s.times}`);
    if (s.metamagic.length > 0) parts.push(`[${s.metamagic.join(', ')}]`);
    const ctx = [s.className, s.book].filter(Boolean).join(' · ');
    return ctx ? `${parts.join(' ')} — ${ctx}` : parts.join(' ');
  };
  diffList(
    'Spells',
    new Map(before.spells.entries.map((s) => [spellKey(s), spellLabel(s)])),
    new Map(after.spells.entries.map((s) => [spellKey(s), spellLabel(s)])),
    out,
  );
  diffList('Languages', new Map(before.attributes.languages.map((l) => [l, l])), new Map(after.attributes.languages.map((l) => [l, l])), out);

  const hp = (b: PcgenCharacter) => b.classLevels.reduce((s, l) => s + (l.hitPoints ?? 0), 0);
  if (hp(before) !== hp(after)) out.push({ section: 'Hit points rolled', kind: 'changed', text: `${hp(before)} → ${hp(after)}` });
  return out;
}
