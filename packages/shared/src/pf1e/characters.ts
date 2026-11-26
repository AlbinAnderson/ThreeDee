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

/** A new character from a freshly parsed .pcg file. */
export function createCharacterFromPcg(
  build: PcgenCharacter,
  opts: { id: string; ownerId: string | null; fileName: string; importedBy: string; now: number },
): Character {
  return {
    id: opts.id,
    name: buildName(build, opts.fileName.replace(/\.pcg$/i, '') || 'Unnamed character'),
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
  const nameWasImported = existing.name === buildName(existing.build, existing.name);
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

const fmtQty = (name: string, qty: number | null) => (qty && qty !== 1 ? `${name} ×${qty}` : name);

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

  diffList(
    'Classes',
    new Map(before.classes.map((c) => [c.name, `${c.name} ${c.level}`])),
    new Map(after.classes.map((c) => [c.name, `${c.name} ${c.level}`])),
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
  const abilityKey = (a: PcgenCharacter['abilities'][number]) => `${a.category}|${a.key}|${a.appliedTo.join(',')}`;
  const abilityLabel = (a: PcgenCharacter['abilities'][number]) =>
    `${a.key}${a.appliedTo.length ? ` (${a.appliedTo.join(', ')})` : ''} [${a.category}]`;
  diffList(
    'Feats & abilities',
    new Map(before.abilities.map((a) => [abilityKey(a), abilityLabel(a)])),
    new Map(after.abilities.map((a) => [abilityKey(a), abilityLabel(a)])),
    out,
  );
  diffList(
    'Equipment',
    new Map(before.equipment.map((e) => [e.name, fmtQty(e.name, e.quantity)])),
    new Map(after.equipment.map((e) => [e.name, fmtQty(e.name, e.quantity)])),
    out,
  );
  const spellKey = (s: PcgenCharacter['spells']['entries'][number]) => `${s.className}|${s.book}|${s.spellName}|${s.level}`;
  const spellLabel = (s: PcgenCharacter['spells']['entries'][number]) =>
    `${s.spellName}${s.level !== null ? ` (level ${s.level})` : ''}${s.className ? `, ${s.className}` : ''}`;
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
