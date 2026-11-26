/**
 * The character's feats, traits, class features, racial traits and
 * proficiencies as one categorized list for the Abilities browser.
 *
 * PCGen saves only *chosen* abilities in a .pcg (feats, traits, discoveries,
 * archetypes, favored class bonuses). Automatic class and racial features are
 * filled in from the VTT's own rules tables, marked `source: 'rules'`.
 */
import type { Character } from '../entities/pf1e';
import { classActionSetsFor, COST_LABEL } from './actions';
import { lookupRace, STAT_KEYS } from './rules';

export type AbilityCategory = 'feat' | 'trait' | 'class' | 'racial' | 'proficiency';

export const ABILITY_CATEGORIES: { id: AbilityCategory; label: string }[] = [
  { id: 'feat', label: 'Feats' },
  { id: 'trait', label: 'Traits' },
  { id: 'class', label: 'Class features' },
  { id: 'racial', label: 'Racial & origin' },
  { id: 'proficiency', label: 'Proficiencies' },
];

export interface AbilityEntry {
  /** Stable within the character (for React keys and selection). */
  id: string;
  category: AbilityCategory;
  name: string;
  /** Sub-heading: the PCGen pool ("Alchemist Discovery"), feat type, or class/race name. */
  group: string;
  /** PCGen nature: NORMAL (chosen), AUTOMATIC (granted), VIRTUAL (granted without prerequisites). */
  nature: string | null;
  appliedTo: string[];
  description: string | null;
  source: 'pcg' | 'rules';
}

/** "Trait ~ Local Ties" -> "Local Ties"; "Alchemist Archetype ~ Beastmorph" -> "Beastmorph". */
export function abilityDisplayName(key: string): string {
  const parts = key.split('~').map((p) => p.trim()).filter(Boolean);
  return parts[parts.length - 1] ?? key.trim();
}

const FEAT_TYPES = ['Combat', 'Metamagic', 'ItemCreation', 'Teamwork', 'Style', 'Critical', 'Grit', 'Panache', 'Performance', 'Story', 'Mythic'];

function featGroup(types: string[]): string {
  const t = FEAT_TYPES.find((x) => types.some((y) => y.toLowerCase() === x.toLowerCase()));
  return t ? `${t === 'ItemCreation' ? 'Item creation' : t} feat` : 'Feat';
}

function categorize(category: string, pool: string): AbilityCategory {
  if (/^feat$/i.test(category) || /feat/i.test(pool)) return 'feat';
  if (/trait|drawback/i.test(pool) || /trait/i.test(category)) return 'trait';
  if (/background|region|racial|race/i.test(category) || /region|racial|race/i.test(pool)) return 'racial';
  return 'class';
}

const signedStat = (n: number) => (n >= 0 ? `+${n}` : `−${-n}`);

/** Everything for the Abilities browser, file entries first, then rules-derived ones. */
export function characterAbilities(c: Character): AbilityEntry[] {
  const out: AbilityEntry[] = [];
  const seen = new Set<string>();
  const add = (e: Omit<AbilityEntry, 'id'>) => {
    const key = `${e.category}|${e.group}|${e.name}|${e.appliedTo.join(',')}`.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ ...e, id: `a${out.length}` });
  };

  for (const a of c.build.abilities) {
    if (a.key.startsWith('*') || a.category.startsWith('*')) continue; // PCGen internals (*LANGBONUS...)
    const category = categorize(a.category, a.pool);
    const appliedTo = a.appliedTo.map((t) => t.trim()).filter((t) => t && t !== ',');
    add({
      category,
      name: abilityDisplayName(a.key),
      group: category === 'feat' ? (/^feat$/i.test(a.pool) ? featGroup(a.types) : a.pool) : a.category === 'Archetype' ? 'Archetype' : a.pool,
      nature: a.nature,
      appliedTo,
      description: a.description,
      source: 'pcg',
    });
  }
  for (const [list, nature] of [
    [c.build.legacyFeats, 'NORMAL'],
    [c.build.virtualFeats, 'VIRTUAL'],
  ] as const) {
    for (const f of list) {
      const m = /^(.*?)\s*\((.+)\)\s*$/.exec(f);
      add({ category: 'feat', name: m ? m[1]! : f, group: 'Feat', nature, appliedTo: m ? [m[2]!] : [], description: null, source: 'pcg' });
    }
  }

  // Class abilities the VTT knows (level-1 actions from the Actions reference).
  for (const { set, level } of classActionSetsFor(c.build.classes)) {
    for (const a of set.actions) {
      add({
        category: 'class',
        name: a.name,
        group: `${set.className} ${level}`,
        nature: 'AUTOMATIC',
        appliedTo: [],
        description: `${a.costLabel ?? COST_LABEL[a.cost]}. ${a.notes}`,
        source: 'rules',
      });
    }
  }

  // Racial traits from the race table.
  const raceName = c.build.attributes.race;
  const race = lookupRace(raceName);
  if (race && raceName) {
    const racial = (name: string, description: string) =>
      add({ category: 'racial', name, group: raceName, nature: 'AUTOMATIC', appliedTo: [], description, source: 'rules' });
    if (race.anyPlusTwo) racial('Ability scores', `+2 to one ability score of your choice${c.sheet.racialChoice ? ` (chosen: ${c.sheet.racialChoice})` : ''}.`);
    else {
      const mods = STAT_KEYS.filter((k) => race.stats[k]).map((k) => `${signedStat(race.stats[k]!)} ${k}`);
      if (mods.length) racial('Ability scores', `${mods.join(', ')}.`);
    }
    racial('Size and speed', `${race.size}, base speed ${race.speed} ft${race.steady ? '; speed is never reduced by armor or encumbrance' : ''}.`);
    if (race.darkvision) racial('Darkvision', `See in the dark up to ${race.darkvision} ft (black and white only).`);
    if (race.lowLight) racial('Low-light vision', 'See twice as far as a human in dim light.');
    for (const [skill, bonus] of Object.entries(race.skills ?? {})) racial(`${skill} ${signedStat(bonus)}`, `Racial ${bonus >= 0 ? 'bonus' : 'penalty'} on ${skill} checks.`);
  }

  const profs = c.build.attributes.weaponProficiencies;
  if (profs.length) {
    add({
      category: 'proficiency',
      name: 'Weapon proficiencies',
      group: `${profs.length} weapons`,
      nature: null,
      appliedTo: [],
      description: [...profs].sort((a, b) => a.localeCompare(b)).join(', '),
      source: 'pcg',
    });
  }
  return out;
}
