/**
 * Generic dice notation: terms joined by + / -.
 *   1d20+5   2d6+1d4-1   4d6kh3   2d20kl1   d%   3
 * Parsing is pure and runs on both sides (client validates early, server rolls).
 */
import { z } from 'zod';

const SignSchema = z.union([z.literal(1), z.literal(-1)]);

export const RollTermSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('dice'),
    sign: SignSchema,
    count: z.number().int(),
    sides: z.number().int(),
    keep: z.object({ mode: z.enum(['h', 'l']), n: z.number().int() }).nullable(),
    rolls: z.array(z.object({ value: z.number().int(), dropped: z.boolean() })).max(1000),
    subtotal: z.number(),
  }),
  z.object({ kind: z.literal('const'), sign: SignSchema, value: z.number() }),
]);
export type RollTerm = z.infer<typeof RollTermSchema>;

export const RollResultSchema = z.object({
  expression: z.string().max(200),
  total: z.number(),
  terms: z.array(RollTermSchema).max(50),
});
export type RollResult = z.infer<typeof RollResultSchema>;

export class DiceError extends Error {}

type ParsedTerm =
  | { kind: 'dice'; sign: 1 | -1; count: number; sides: number; keep: { mode: 'h' | 'l'; n: number } | null }
  | { kind: 'const'; sign: 1 | -1; value: number };

const LIMITS = { dice: 200, sides: 10000, terms: 20, length: 200, constant: 1_000_000 };

const TERM_RE = /([+-])?(?:(\d*)d(\d+|%)(?:(kh|kl|k)(\d+))?|(\d+))/y;

export function parseDice(input: string): ParsedTerm[] {
  const src = input.replace(/\s+/g, '').toLowerCase();
  if (!src) throw new DiceError('Empty roll');
  if (src.length > LIMITS.length) throw new DiceError('Roll expression too long');

  const terms: ParsedTerm[] = [];
  let i = 0;
  let totalDice = 0;
  while (i < src.length) {
    TERM_RE.lastIndex = i;
    const m = TERM_RE.exec(src);
    if (!m || m[0].length === 0) throw new DiceError(`Can't understand "${src.slice(i)}"`);
    if (terms.length > 0 && !m[1]) throw new DiceError('Expected + or - between terms');
    const sign = m[1] === '-' ? -1 : 1;

    if (m[6] !== undefined) {
      const value = parseInt(m[6], 10);
      if (value > LIMITS.constant) throw new DiceError('Number too large');
      terms.push({ kind: 'const', sign, value });
    } else {
      const count = m[2] ? parseInt(m[2], 10) : 1;
      const sides = m[3] === '%' ? 100 : parseInt(m[3]!, 10);
      if (count < 1) throw new DiceError('Must roll at least one die');
      if (sides < 1) throw new DiceError('Dice need at least one side');
      if (sides > LIMITS.sides) throw new DiceError(`Dice can have at most ${LIMITS.sides} sides`);
      totalDice += count;
      if (totalDice > LIMITS.dice) throw new DiceError(`At most ${LIMITS.dice} dice per roll`);
      let keep: { mode: 'h' | 'l'; n: number } | null = null;
      if (m[4]) {
        const n = parseInt(m[5]!, 10);
        if (n < 1 || n > count) throw new DiceError(`Can't keep ${n} of ${count} dice`);
        keep = { mode: m[4] === 'kl' ? 'l' : 'h', n };
      }
      terms.push({ kind: 'dice', sign, count, sides, keep });
    }
    if (terms.length > LIMITS.terms) throw new DiceError('Too many terms');
    i = TERM_RE.lastIndex;
  }
  return terms;
}

/** @param random returns a uniformly distributed integer in [0, maxExclusive). */
export function rollDice(expression: string, random: (maxExclusive: number) => number): RollResult {
  const parsed = parseDice(expression);
  let total = 0;
  const terms: RollTerm[] = parsed.map((t) => {
    if (t.kind === 'const') {
      total += t.sign * t.value;
      return t;
    }
    const rolls = Array.from({ length: t.count }, () => ({ value: random(t.sides) + 1, dropped: false }));
    if (t.keep) {
      const order = rolls
        .map((r, idx) => ({ v: r.value, idx }))
        .sort((a, b) => (t.keep!.mode === 'h' ? b.v - a.v : a.v - b.v));
      order.slice(t.keep.n).forEach(({ idx }) => (rolls[idx]!.dropped = true));
    }
    const subtotal = rolls.reduce((s, r) => (r.dropped ? s : s + r.value), 0);
    total += t.sign * subtotal;
    return { ...t, rolls, subtotal };
  });
  return { expression: expression.trim(), total, terms };
}

export function formatTermNotation(t: RollTerm): string {
  if (t.kind === 'const') return String(t.value);
  const keep = t.keep ? `k${t.keep.mode}${t.keep.n}` : '';
  return `${t.count}d${t.sides}${keep}`;
}
