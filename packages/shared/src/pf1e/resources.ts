/** Daily/round resources of class actions (Rage rounds, Channel Energy uses...). */
import type { Character } from '../entities/pf1e';
import type { ClassActionSet, ResourceDef } from './actions';
import { computeCharacterStats, type CharacterStats } from './engine';

/** Key under Character.runtime.uses, namespaced by class so e.g. Paladin and Antipaladin smites don't collide. */
export function resourceKey(set: ClassActionSet, resourceId: string): string {
  return `${set.keys[0]}.${resourceId}`;
}

export function resourceMax(c: Character, def: ResourceDef, level: number, stats?: CharacterStats): number {
  const s = stats ?? computeCharacterStats(c);
  return Math.max(0, def.max({ level, mod: (k) => s.abilities[k].mod }));
}
