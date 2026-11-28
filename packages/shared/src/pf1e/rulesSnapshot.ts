/**
 * Compact server-side snapshot of PCGen rules-pack data relevant to a single
 * character (Epic 13.3). Keeps the client deterministic & offline-safe without
 * shipping the multi-MB rules pack over WebSocket, while preventing double-counting
 * with Core feats/abilities already modeled dynamically in engine.ts / skills.ts.
 */
import {
  EMPTY_RULES_DATA,
  type CharacterRulesBonus,
  type CharacterRulesData,
  type ClassSnapshot,
  type RaceSnapshot,
} from '../entities/pf1e';
import type { PcgenCharacter } from '../pcgen/schema';
import type { RulesProvider } from '../rules/types';
import { featKey, MODELED_FEAT_KEYS, normalizeName, resolveClassName, STAT_KEYS } from './rules';
import { MODELED_SKILL_FEAT_KEYS } from './skills';

/**
 * Normalized feat/ability keys already computed dynamically by `engine.ts`,
 * `skills.ts`, `toggles.ts`, and `spells.ts`. Derived programmatically from
 * the engine's own tables so `rulesData.bonuses` can never double-count them.
 */
const EXTRA_MODELED_KEYS = [
  'weaponfocus',
  'greaterweaponfocus',
  'weaponspecialization',
  'greaterweaponspecialization',
  'powerattack',
  'deadlyaim',
  'piranhastrike',
  'combatexpertise',
  'twoweaponfighting',
  'improvedtwoweaponfighting',
  'greatertwoweaponfighting',
  'weaponfinesse',
  'agilemaneuvers',
  'defensivecombattraining',
  'combatreflexes',
  'improvedcritical',
  'spellfocus',
  'greaterspellfocus',
  'spellpenetration',
  'greaterspellpenetration',
  'druidnaturesense',
  'naturesense',
];

export const ENGINE_MODELED_FEAT_KEYS: ReadonlySet<string> = new Set(
  [...MODELED_FEAT_KEYS, ...MODELED_SKILL_FEAT_KEYS, ...EXTRA_MODELED_KEYS].map(featKey),
);

/** True when `rulesData` holds no snapshotted entries (required on client `character/import` payloads). */
export function isRulesDataEmpty(d: CharacterRulesData): boolean {
  return (
    Object.keys(d.classes).length === 0 &&
    d.race === null &&
    d.bonuses.length === 0 &&
    Object.keys(d.spellSchools).length === 0
  );
}

/** True when a PCGen ability record represents racial default stats/skills already modeled by RaceData. */
function isRacialDefaultRecord(key: string, types: string[]): boolean {
  if (/~\s*ability\s+scores$/i.test(key)) return true;
  return types.some((t) => /^racial\s+ability\s+scores$/i.test(t) || /\s+racial\s+default$/i.test(t));
}

/**
 * Build a compact, bounded `CharacterRulesData` snapshot for a character from
 * the server's loaded `RulesProvider`. Returns empty snapshot if no pack is loaded.
 */
export function buildCharacterRulesData(build: PcgenCharacter, rules?: RulesProvider): CharacterRulesData {
  if (!rules) return structuredClone(EMPTY_RULES_DATA);

  const classes: Record<string, ClassSnapshot> = {};
  for (const cls of build.classes) {
    if (Object.keys(classes).length >= 20) break;
    const resolvedName = resolveClassName({ build }, cls.name);
    const rec = rules.byName('class', resolvedName) ?? rules.byName('class', cls.name);
    if (!rec || rec.hd === null || rec.bab === null) continue;
    const norm = normalizeName(cls.name).slice(0, 60);
    if (!norm) continue;
    classes[norm] = {
      hd: Math.max(4, Math.min(12, Math.floor(rec.hd))),
      bab: rec.bab,
      goodSaves: rec.goodSaves.slice(0, 3),
      prestige: rec.prestige,
      classSkills: rec.classSkills.slice(0, 40).map((s) => s.slice(0, 60)),
    };
  }

  let race: RaceSnapshot | null = null;
  if (build.attributes.race) {
    const rec = rules.byName('race', build.attributes.race);
    if (rec && rec.size && rec.speed !== null) {
      const skillBonuses: Record<string, number> = {};
      for (const [k, v] of Object.entries(rec.skillBonuses)) {
        if (Object.keys(skillBonuses).length >= 30) break;
        if (Number.isInteger(v) && v >= -50 && v <= 50) skillBonuses[k.slice(0, 60)] = v;
      }
      race = {
        size: rec.size,
        speed: Math.max(0, Math.min(200, Math.floor(rec.speed))),
        abilityMods: rec.abilityMods,
        anyPlusTwo: rec.anyPlusTwo,
        steady: rec.steady,
        darkvision: Math.max(0, Math.min(600, Math.floor(rec.darkvision))),
        lowLight: rec.lowLight,
        skillBonuses,
      };
    }
  }

  const bonuses: CharacterRulesBonus[] = [];
  const seenFeatKeys = new Set<string>();
  const seenIds = new Set<string>();
  // Count repeated stackable abilities (e.g. Favored Class Bonus ~ Hit Point taken multiple levels).
  const abilityCounts = new Map<string, number>();
  for (const a of build.abilities) {
    const fk = featKey(a.key);
    if (!fk) continue;
    abilityCounts.set(fk, (abilityCounts.get(fk) ?? 0) + Math.max(1, a.appliedTo.length));
  }
  const abilityKeys = [
    ...build.abilities.map((a) => a.key),
    ...build.legacyFeats,
    ...build.virtualFeats,
  ];
  const isStackableRulesAbility = (key: string) => /favored\s*class\s*bonus\s*~\s*hit\s*point/i.test(key);
  for (const rawKey of abilityKeys) {
    if (bonuses.length >= 100) break;
    const fk = featKey(rawKey);
    if (!fk || seenFeatKeys.has(fk) || ENGINE_MODELED_FEAT_KEYS.has(fk)) continue;
    seenFeatKeys.add(fk);
    const rec =
      rules.get('feat', rawKey) ??
      rules.get('ability', rawKey) ??
      rules.byName('feat', rawKey) ??
      rules.byName('ability', rawKey);
    if (!rec?.bonuses?.length) continue;
    // Skip ONLY stat/skill bonuses from racial default records; preserve non-stat/non-skill racial bonuses
    // (saves, initiative, speed, AC) and all alternate racial traits.
    const skipRacialDefaultStatSkill = isRacialDefaultRecord(rec.key, rec.types);
    const mult = isStackableRulesAbility(rec.key) || isStackableRulesAbility(rawKey) ? Math.max(1, abilityCounts.get(fk) ?? 1) : 1;
    const source = rec.name.replace(/^trait\s*~\s*/i, '').trim().slice(0, 80) || rawKey.slice(0, 80);
    rec.bonuses.forEach((b, idx) => {
      if (bonuses.length >= 100) return;
      if (skipRacialDefaultStatSkill && ((STAT_KEYS as string[]).includes(b.target) || b.target === 'skill')) return;
      const id = `${fk.slice(0, 80)}:${idx}`;
      if (seenIds.has(id)) return;
      seenIds.add(id);
      const value = Math.max(-50, Math.min(50, b.value * mult));
      bonuses.push({ ...b, value, id, source: mult > 1 ? `${source} ×${mult}`.slice(0, 80) : source });
    });
  }

  const spellSchools: Record<string, string> = {};
  for (const sp of build.spells.entries) {
    if (Object.keys(spellSchools).length >= 400) break;
    const norm = normalizeName(sp.spellName).slice(0, 80);
    if (!norm || norm in spellSchools) continue;
    const rec = rules.byName('spell', sp.spellName);
    if (rec?.school) spellSchools[norm] = rec.school.trim().slice(0, 40);
  }

  return { classes, race, bonuses, spellSchools };
}
