/**
 * Spell data from the rules pack (Epic 11) for spell cards and the template
 * tool, on top of the curated table in pf1e/spellData.ts.
 */
import { lookupSpell, type SpellArea, type SpellRef } from '../pf1e/spellData';
import type { RulesProvider, SpellRecord } from './types';

const SHAPES: [RegExp, SpellArea['kind']][] = [
  [/^(?:-?radius\s+)?(?:spread|burst|emanation|cylinder)$/, 'circle'],
  [/^radius$/, 'circle'],
  [/^cone(?:-shaped)?(?:\s+(?:burst|spread|emanation))?$/, 'cone'],
  [/^line$/, 'line'],
  [/^(?:cube|square)s?$/, 'square'],
];

/**
 * An area, target or effect line -> a template shape:
 *   "20-ft.-radius spread" -> circle 20, "30-ft. cone" / "60-ft. cone-shaped burst" -> cone,
 *   "120-ft. line" -> line, "cylinder (10-ft. radius, 30 ft. high)" -> circle 10,
 *   "10-ft. cube" -> square. Anything else (a creature, "Close range") -> null.
 */
export function parseSpellArea(text: string | null | undefined): SpellArea | null {
  if (!text) return null;
  const t = text.toLowerCase().replace(/[–—]/g, '-');
  // "<n>-ft.(-radius) <shape>" (the usual PF1e form).
  const re = /(\d{1,4})\s*-?\s*(?:ft\.?|feet|foot)\s*-?\s*((?:-?radius\s+)?(?:spread|burst|emanation|cylinder)|radius|cone(?:-shaped)?(?:\s+(?:burst|spread|emanation))?|line|cubes?|squares?)\b/;
  const m = re.exec(t);
  if (m) {
    const feet = Number(m[1]);
    const shapeText = m[2]!.replace(/\s+/g, ' ').trim();
    for (const [pat, kind] of SHAPES) {
      if (pat.test(shapeText)) return feet > 0 ? { kind, feet, label: text.trim().slice(0, 60) } : null;
    }
  }
  // "cylinder (10-ft. radius, 30 ft. high)", "line 120 ft. long".
  const cyl = /cylinder\s*\(\s*(\d{1,4})\s*-?\s*ft\.?\s*-?\s*radius/.exec(t);
  if (cyl) return { kind: 'circle', feet: Number(cyl[1]), label: text.trim().slice(0, 60) };
  const line = /\bline\s+(\d{1,4})\s*-?\s*ft/.exec(t);
  if (line) return { kind: 'line', feet: Number(line[1]), label: text.trim().slice(0, 60) };
  return null;
}

/** "Evocation (Creation) [fire, acid]". */
export function spellSchoolLine(rec: Pick<SpellRecord, 'school' | 'subschool' | 'descriptors'>): string {
  const school = rec.school ?? 'Unknown school';
  return `${school}${rec.subschool ? ` (${rec.subschool.toLowerCase()})` : ''}${rec.descriptors.length ? ` [${rec.descriptors.join(', ').toLowerCase()}]` : ''}`;
}

export interface FullSpellRef extends SpellRef {
  level?: string;
  castTime?: string;
  components?: string;
  range?: string;
  targetArea?: string;
  duration?: string;
  /** "Core Rulebook p.283". */
  citation?: string;
}

const clean = (s: string | null | undefined) => (s ?? '').trim();

/** "Sorcerer/Wizard 3, Magus 3". */
export function spellLevelLine(classes: Record<string, number>): string {
  const byLevel = new Map<number, string[]>();
  for (const [k, v] of Object.entries(classes)) byLevel.set(v, [...(byLevel.get(v) ?? []), k]);
  return [...byLevel.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([lvl, names]) => `${names.join('/')} ${lvl}`)
    .join(', ');
}

export const citation = (src: { long: string; page: string | null }) => `${src.long}${src.page ? ` ${src.page}` : ''}`;

/** A pack spell record as a spell reference (full description as text). */
export function spellRefFromRecord(rec: SpellRecord): FullSpellRef {
  return {
    name: rec.name,
    school: spellSchoolLine(rec),
    save: clean(rec.save) || 'none',
    sr: clean(rec.sr) || 'no',
    area: parseSpellArea(rec.targetArea),
    text: rec.desc,
    level: spellLevelLine(rec.classes),
    castTime: clean(rec.castTime) || undefined,
    components: clean(rec.components) || undefined,
    range: clean(rec.range) || undefined,
    targetArea: clean(rec.targetArea) || undefined,
    duration: clean(rec.duration) || undefined,
    citation: citation(rec.source),
  };
}

/**
 * The best reference for a spell: the rules pack's record (exact fields and
 * area) with the curated table's one-line effect for chat cards when it has
 * one; either alone when only one knows the spell.
 */
export function resolveSpellRef(name: string, rules?: RulesProvider): FullSpellRef | undefined {
  const curated = lookupSpell(name);
  const rec = rules?.byName('spell', name);
  if (!rec) return curated;
  const fromPack = spellRefFromRecord(rec);
  if (!curated) return { ...fromPack, text: fromPack.text.length > 600 ? `${fromPack.text.slice(0, 597)}...` : fromPack.text };
  return { ...fromPack, text: curated.text, area: fromPack.area ?? curated.area };
}
