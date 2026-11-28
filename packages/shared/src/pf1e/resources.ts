/** Daily/round resources of class actions (Rage rounds, Channel Energy uses...). */
import type { Character } from '../entities/pf1e';
import type { ClassActionSet, ResourceDef } from './actions';
import { computeCharacterStats, type CharacterStats } from './engine';
import { featKey } from './rules';

/** Key under Character.runtime.uses, namespaced by class so e.g. Paladin and Antipaladin smites don't collide. */
export function resourceKey(set: ClassActionSet, resourceId: string): string {
  return `${set.keys[0]}.${resourceId}`;
}

/** Count how many times a stackable feat (Extra Rage, Extra Performance, Extra Channel...) appears on the character. */
function countFeat(c: Character, targetKey: string): number {
  let count = 0;
  for (const a of c.build.abilities) {
    if (featKey(a.key) === targetKey) count += Math.max(1, a.appliedTo.length);
  }
  for (const f of [...c.build.legacyFeats, ...c.build.virtualFeats]) {
    if (featKey(f) === targetKey) count += 1;
  }
  return count;
}

export function resourceMax(c: Character, def: ResourceDef, level: number, stats?: CharacterStats): number {
  const s = stats ?? computeCharacterStats(c);
  return Math.max(
    0,
    def.max({
      level,
      mod: (k) => s.abilities[k].mod,
      permanentMod: (k) => s.abilities[k].permanentMod,
      featCount: (key) => countFeat(c, key),
    }),
  );
}

/** Starting pool after an 8-hour rest (defaults to `resourceMax`; Arcanist Arcane Reservoir starts at 3 + floor(level/2)). */
export function resourceStart(c: Character, def: ResourceDef, level: number, stats?: CharacterStats): number {
  const s = stats ?? computeCharacterStats(c);
  const max = resourceMax(c, def, level, s);
  if (!def.start) return max;
  const start = def.start({
    level,
    mod: (k) => s.abilities[k].mod,
    permanentMod: (k) => s.abilities[k].permanentMod,
    featCount: (key) => countFeat(c, key),
  });
  return Math.max(0, Math.min(max, start));
}
