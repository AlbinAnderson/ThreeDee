/**
 * PF1e typed bonuses and stacking.
 *
 * Every derived number is a list of modifiers. Bonuses of the same type
 * don't stack (only the highest applies), except dodge, circumstance and
 * untyped bonuses. Penalties always stack. Each total keeps its breakdown
 * so the UI can show where a number comes from.
 */

export type BonusType =
  | 'base'
  | 'ability'
  | 'untyped'
  | 'alchemical'
  | 'armor'
  | 'circumstance'
  | 'competence'
  | 'deflection'
  | 'dodge'
  | 'enhancement'
  | 'inherent'
  | 'insight'
  | 'luck'
  | 'morale'
  | 'natural'
  | 'profane'
  | 'racial'
  | 'resistance'
  | 'sacred'
  | 'shield'
  | 'size'
  | 'trait';

/** Types whose bonuses add together. ('base' and 'ability' are structural parts, not real bonus types.) */
const STACKS = new Set<BonusType>(['base', 'ability', 'untyped', 'dodge', 'circumstance']);

export interface Modifier {
  value: number;
  type: BonusType;
  /** Where it comes from, e.g. "Dex", "Improved Initiative", "Chain shirt +1". */
  source: string;
}

export interface StatPart extends Modifier {
  /** False when overruled by a bigger bonus of the same type. */
  applied: boolean;
}

export interface StatLine {
  total: number;
  parts: StatPart[];
}

export function sumModifiers(mods: Modifier[]): StatLine {
  const parts: StatPart[] = mods.filter((m) => m.value !== 0).map((m) => ({ ...m, applied: true }));
  // Highest bonus of each non-stacking type wins.
  const best = new Map<BonusType, StatPart>();
  for (const p of parts) {
    if (p.value < 0 || STACKS.has(p.type)) continue;
    const cur = best.get(p.type);
    if (!cur || p.value > cur.value) best.set(p.type, p);
  }
  for (const p of parts) {
    if (p.value > 0 && !STACKS.has(p.type) && best.get(p.type) !== p) p.applied = false;
  }
  return { total: parts.reduce((s, p) => (p.applied ? s + p.value : s), 0), parts };
}

export const signed = (n: number) => (n >= 0 ? `+${n}` : String(n));

/** "Base 3, Con +2, Great Fortitude +2" (for tooltips and roll labels). */
export function describeLine(line: StatLine): string {
  return line.parts
    .map((p) => `${p.source} ${p.type === 'base' ? p.value : signed(p.value)}${p.applied ? '' : ' (doesn’t stack)'}`)
    .join(', ');
}
