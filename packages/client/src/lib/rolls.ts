import type { RollResult } from '@vtt/shared';

export type D20Highlight = 'nat20' | 'nat1' | '';

/** Natural 20 / natural 1 on the roll's first d20 term, ignoring dropped dice (e.g. 2d20kh1). */
export function d20Highlight(roll: RollResult | null | undefined): D20Highlight {
  if (!roll) return '';
  const d20 = roll.terms.find((t) => t.kind === 'dice' && t.sides === 20);
  if (!d20 || d20.kind !== 'dice') return '';
  const kept = d20.rolls.filter((r) => !r.dropped);
  if (kept.some((r) => r.value === 20)) return 'nat20';
  if (kept.some((r) => r.value === 1)) return 'nat1';
  return '';
}
