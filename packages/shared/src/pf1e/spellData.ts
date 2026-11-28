/**
 * PF1e spellcasting reference data the .pcg file doesn't contain: which
 * classes cast and how, base spells per day, metamagic level adjustments, and
 * a curated set of common spells (school, save, SR, area) for spell cards.
 * Anything missing is set per class in the Spells tab's casting settings.
 */
import { normalizeName, type StatKey } from './rules';

export type CastingModel = 'prepared' | 'spontaneous' | 'hybrid';
export type CastingTradition = 'arcane' | 'divine' | 'psychic' | 'alchemical';

export interface CasterClass {
  model: CastingModel;
  stat: StatKey;
  tradition: CastingTradition;
  /** Base spells per day by class level (index 0 = level 1), each for spell levels 0..9; null = can't cast that level. */
  perDay: (number | null)[][];
  /** Arcanist: how many spells may be prepared per spell level each day. */
  preparedPerDay?: (number | null)[][];
  /** 0-level spells (cantrips, orisons, knacks) are cast at will. */
  cantrips: boolean;
  /** Prepares from a spellbook / formula book / familiar (only spells in it); otherwise from the whole class list. */
  book: boolean;
  /** Caster level = class level + this (paladins and rangers cast at level − 3). */
  clOffset: number;
  /** Minimum class level before spellcasting begins (Bloodrager casts at full CL starting at level 4). */
  minLevel?: number;
  /** Extra prepared slot per spell level 1+: domain (cleric, druid with a domain), school (specialist wizard), spirit (shaman). */
  bonusSlot?: 'domain' | 'school' | 'spirit';
  /** Spontaneously convert a prepared spell: Cure/Inflict (cleric, warpriest) or Summon Nature's Ally (druid). */
  convert?: 'cureInflict' | 'summonNaturesAlly';
  /** What the class calls its spells, for labels. */
  noun?: string;
}

/** "3,1" -> [3, 1]; "-" -> null. Rows are class levels 1-20. */
const table = (rows: string[]): (number | null)[][] => rows.map((r) => r.split(',').map((x) => (x === '-' ? null : Number(x))));

// Core Rulebook / APG / ACG / Occult Adventures spells-per-day tables (base, before bonus spells).
const FULL_PREPARED = table([
  '3,1', '4,2', '4,2,1', '4,3,2', '4,3,2,1', '4,3,3,2', '4,4,3,2,1', '4,4,3,3,2', '4,4,4,3,2,1', '4,4,4,3,3,2',
  '4,4,4,4,3,2,1', '4,4,4,4,3,3,2', '4,4,4,4,4,3,2,1', '4,4,4,4,4,3,3,2', '4,4,4,4,4,4,3,2,1', '4,4,4,4,4,4,3,3,2',
  '4,4,4,4,4,4,4,3,2,1', '4,4,4,4,4,4,4,3,3,2', '4,4,4,4,4,4,4,4,3,3', '4,4,4,4,4,4,4,4,4,4',
]);
const FULL_SPONTANEOUS = table([
  '-,3', '-,4', '-,5', '-,6,3', '-,6,4', '-,6,5,3', '-,6,6,4', '-,6,6,5,3', '-,6,6,6,4', '-,6,6,6,5,3',
  '-,6,6,6,6,4', '-,6,6,6,6,5,3', '-,6,6,6,6,6,4', '-,6,6,6,6,6,5,3', '-,6,6,6,6,6,6,4', '-,6,6,6,6,6,6,5,3',
  '-,6,6,6,6,6,6,6,4', '-,6,6,6,6,6,6,6,5,3', '-,6,6,6,6,6,6,6,6,4', '-,6,6,6,6,6,6,6,6,6',
]);
const ARCANIST_SLOTS = table([
  '-,2', '-,3', '-,4', '-,4,2', '-,4,3', '-,4,4,2', '-,4,4,3', '-,4,4,4,2', '-,4,4,4,3', '-,4,4,4,4,2',
  '-,4,4,4,4,3', '-,4,4,4,4,4,2', '-,4,4,4,4,4,3', '-,4,4,4,4,4,4,2', '-,4,4,4,4,4,4,3', '-,4,4,4,4,4,4,4,2',
  '-,4,4,4,4,4,4,4,3', '-,4,4,4,4,4,4,4,4,2', '-,4,4,4,4,4,4,4,4,3', '-,4,4,4,4,4,4,4,4,4',
]);
const ARCANIST_PREPARED = table([
  '4,2', '5,2', '5,3', '6,3,1', '6,4,2', '7,4,2,1', '7,5,3,2', '8,5,3,2,1', '8,5,4,3,2', '9,5,4,3,2,1',
  '9,5,5,4,3,2', '9,5,5,4,3,2,1', '9,5,5,4,4,3,2', '9,5,5,4,4,3,2,1', '9,5,5,4,4,4,3,2', '9,5,5,4,4,4,3,2,1',
  '9,5,5,4,4,4,3,3,2', '9,5,5,4,4,4,3,3,2,1', '9,5,5,4,4,4,3,3,3,2', '9,5,5,4,4,4,3,3,3,3',
]);
const SIX_SPONTANEOUS = table([
  '-,1', '-,2', '-,3', '-,3,1', '-,4,2', '-,4,3', '-,4,3,1', '-,4,4,2', '-,5,4,3', '-,5,4,3,1',
  '-,5,4,4,2', '-,5,5,4,3', '-,5,5,4,3,1', '-,5,5,4,4,2', '-,5,5,5,4,3', '-,5,5,5,4,3,1',
  '-,5,5,5,4,4,2', '-,5,5,5,5,4,3', '-,5,5,5,5,5,4', '-,5,5,5,5,5,5',
]);
const SIX_PREPARED = table([
  '3,1', '4,2', '4,3', '4,3,1', '4,4,2', '5,4,3', '5,4,3,1', '5,4,4,2', '5,5,4,3', '5,5,4,3,1',
  '5,5,4,4,2', '5,5,5,4,3', '5,5,5,4,3,1', '5,5,5,4,4,2', '5,5,5,5,4,3', '5,5,5,5,4,3,1',
  '5,5,5,5,4,4,2', '5,5,5,5,5,4,3', '5,5,5,5,5,5,4', '5,5,5,5,5,5,5',
]);
/** Paladin, ranger, antipaladin: 0 = bonus spells only. */
const FOUR_LEVEL = table([
  '-', '-', '-', '-,0', '-,1', '-,1', '-,1,0', '-,1,1', '-,2,1', '-,2,1,0',
  '-,2,1,1', '-,2,2,1', '-,3,2,1,0', '-,3,2,1,1', '-,3,2,2,1', '-,3,3,2,1',
  '-,4,3,2,1', '-,4,3,2,2', '-,4,3,3,2', '-,4,4,3,3',
]);
/** Bloodrager (ACG): spontaneous 4-level caster, 1 base slot when each level unlocks (no 0 entries). */
const FOUR_SPONTANEOUS = table([
  '-', '-', '-', '-,1', '-,1', '-,1', '-,1,1', '-,1,1', '-,2,1', '-,2,1,1',
  '-,2,1,1', '-,2,2,1', '-,3,2,1,1', '-,3,2,1,1', '-,3,2,2,1', '-,3,3,2,1',
  '-,4,3,2,1', '-,4,3,2,2', '-,4,3,3,2', '-,4,4,3,2',
]);
/** Adept (CRB p.448): prepared 5-level divine NPC caster. */
const ADEPT_PREPARED = table([
  '3,1', '3,1', '3,2', '3,2,0', '3,2,1', '3,2,1', '3,3,2', '3,3,2,0', '3,3,2,1', '3,3,2,1',
  '3,3,3,2', '3,3,3,2,0', '3,3,3,2,1', '3,3,3,2,1', '3,3,3,3,2', '3,3,3,3,2,0', '3,3,3,3,2,1',
  '3,3,3,3,2,1', '3,3,3,3,3,2', '3,3,3,3,3,2',
]);

const cls = (model: CastingModel, stat: StatKey, tradition: CastingTradition, perDay: (number | null)[][], extra: Partial<CasterClass> = {}): CasterClass => ({
  model,
  stat,
  tradition,
  perDay,
  cantrips: true,
  book: false,
  clOffset: 0,
  ...extra,
});

const CASTERS: Record<string, CasterClass> = {
  // Prepared from a book
  wizard: cls('prepared', 'INT', 'arcane', FULL_PREPARED, { book: true, bonusSlot: 'school' }),
  witch: cls('prepared', 'INT', 'arcane', FULL_PREPARED, { book: true }),
  magus: cls('prepared', 'INT', 'arcane', SIX_PREPARED, { book: true }),
  alchemist: cls('prepared', 'INT', 'alchemical', SIX_SPONTANEOUS, { book: true, cantrips: false, noun: 'extracts' }),
  investigator: cls('prepared', 'INT', 'alchemical', SIX_SPONTANEOUS, { book: true, cantrips: false, noun: 'extracts' }),
  // Prepared from the whole class list
  cleric: cls('prepared', 'WIS', 'divine', FULL_PREPARED, { bonusSlot: 'domain', convert: 'cureInflict' }),
  druid: cls('prepared', 'WIS', 'divine', FULL_PREPARED, { bonusSlot: 'domain', convert: 'summonNaturesAlly' }),
  shaman: cls('prepared', 'WIS', 'divine', FULL_PREPARED, { bonusSlot: 'spirit' }),
  warpriest: cls('prepared', 'WIS', 'divine', SIX_PREPARED, { convert: 'cureInflict' }),
  paladin: cls('prepared', 'CHA', 'divine', FOUR_LEVEL, { cantrips: false, clOffset: -3 }),
  antipaladin: cls('prepared', 'CHA', 'divine', FOUR_LEVEL, { cantrips: false, clOffset: -3 }),
  ranger: cls('prepared', 'WIS', 'divine', FOUR_LEVEL, { cantrips: false, clOffset: -3 }),
  adept: cls('prepared', 'WIS', 'divine', ADEPT_PREPARED),
  // Spontaneous
  sorcerer: cls('spontaneous', 'CHA', 'arcane', FULL_SPONTANEOUS),
  oracle: cls('spontaneous', 'CHA', 'divine', FULL_SPONTANEOUS),
  psychic: cls('spontaneous', 'INT', 'psychic', FULL_SPONTANEOUS),
  bard: cls('spontaneous', 'CHA', 'arcane', SIX_SPONTANEOUS),
  skald: cls('spontaneous', 'CHA', 'arcane', SIX_SPONTANEOUS),
  summoner: cls('spontaneous', 'CHA', 'arcane', SIX_SPONTANEOUS),
  summonerunchained: cls('spontaneous', 'CHA', 'arcane', SIX_SPONTANEOUS),
  unchainedsummoner: cls('spontaneous', 'CHA', 'arcane', SIX_SPONTANEOUS),
  inquisitor: cls('spontaneous', 'WIS', 'divine', SIX_SPONTANEOUS),
  hunter: cls('spontaneous', 'WIS', 'divine', SIX_SPONTANEOUS),
  mesmerist: cls('spontaneous', 'CHA', 'psychic', SIX_SPONTANEOUS),
  occultist: cls('spontaneous', 'INT', 'psychic', SIX_SPONTANEOUS),
  spiritualist: cls('spontaneous', 'WIS', 'psychic', SIX_SPONTANEOUS),
  bloodrager: cls('spontaneous', 'CHA', 'arcane', FOUR_SPONTANEOUS, { cantrips: false, minLevel: 4 }),
  medium: cls('spontaneous', 'CHA', 'psychic', FOUR_SPONTANEOUS),
  // Hybrid: prepares spells known for the day, casts them with shared slots
  arcanist: cls('hybrid', 'INT', 'arcane', ARCANIST_SLOTS, { book: true, preparedPerDay: ARCANIST_PREPARED }),
};

export function lookupCasterClass(name: string): CasterClass | undefined {
  return CASTERS[normalizeName(name)];
}

/**
 * Bonus spells per day from a high casting ability (Core Rulebook Table 1-3):
 * one at each spell level up to the modifier, one more every 4 points.
 */
export function bonusSpells(abilityMod: number, spellLevel: number): number {
  if (spellLevel < 1 || abilityMod < spellLevel) return 0;
  return Math.floor((abilityMod - spellLevel) / 4) + 1;
}

// ------------------------------------------------------------------ metamagic

/** Slot level increase of metamagic feats (by featKey). Heighten is variable (the slot it's prepared in). */
const METAMAGIC: Record<string, number> = {
  empowerspell: 2,
  enlargespell: 1,
  extendspell: 1,
  maximizespell: 3,
  quickenspell: 4,
  silentspell: 1,
  stillspell: 1,
  widenspell: 3,
  bouncingspell: 1,
  burningspell: 2,
  concussivespell: 2,
  dazingspell: 3,
  disruptivespell: 1,
  ectoplasmicspell: 1,
  elementalspell: 1,
  flaringspell: 1,
  focusedspell: 1,
  intensifiedspell: 1,
  lingeringspell: 1,
  mercifulspell: 0,
  persistentspell: 2,
  piercingspell: 1,
  reachspell: 1,
  rimespell: 1,
  selectivespell: 1,
  sickeningspell: 2,
  thunderingspell: 2,
  topplingspell: 1,
};

const metamagicKey = (name: string) => normalizeName(name.replace(/\(.*\)$/, ''));

export const isHeighten = (name: string) => metamagicKey(name) === 'heightenspell';

/** Level increase of a metamagic feat; undefined if unknown (or Heighten). */
export function metamagicAdjust(name: string): number | undefined {
  return METAMAGIC[metamagicKey(name)];
}

/** Whether a feat name is a metamagic feat the tables know (Heighten included). */
export function isMetamagicFeat(name: string): boolean {
  return metamagicAdjust(name) !== undefined || isHeighten(name);
}

// ------------------------------------------------------------------ spells

export interface SpellArea {
  kind: 'circle' | 'cone' | 'line' | 'square';
  /** Radius (circle), length (cone, line) or side (square), in feet. */
  feet: number;
  /** "20-ft.-radius spread" */
  label: string;
}

export interface SpellRef {
  name: string;
  school: string;
  /** Saving throw line, e.g. "Reflex half". */
  save: string;
  /** Spell resistance line, e.g. "yes", "no", "yes (harmless)". */
  sr: string;
  area: SpellArea | null;
  text: string;
}

const AREA_SHAPES: Record<string, (ft: number) => SpellArea> = {
  cone: (ft) => ({ kind: 'cone', feet: ft, label: `${ft}-ft. cone` }),
  burst: (ft) => ({ kind: 'circle', feet: ft, label: `${ft}-ft.-radius burst` }),
  spread: (ft) => ({ kind: 'circle', feet: ft, label: `${ft}-ft.-radius spread` }),
  emanation: (ft) => ({ kind: 'circle', feet: ft, label: `${ft}-ft.-radius emanation` }),
  cylinder: (ft) => ({ kind: 'circle', feet: ft, label: `${ft}-ft.-radius cylinder` }),
  line: (ft) => ({ kind: 'line', feet: ft, label: `${ft}-ft. line` }),
  square: (ft) => ({ kind: 'square', feet: ft, label: `${ft}-ft. square` }),
};

/** [name, school, save, SR, area ("cone:15", "spread:20"... or ""), short effect]. */
type Row = [string, string, string, string, string, string];

const HARMLESS = 'Will negates (harmless)';
const SR_HARMLESS = 'yes (harmless)';

const SPELL_ROWS: Row[] = [
  // 0-level
  ['Acid Splash', 'Conjuration (creation) [acid]', 'none', 'no', '', 'Ranged touch attack: 1d3 acid damage.'],
  ['Arcane Mark', 'Universal', 'none', 'no', '', 'Inscribe a personal rune on an object or creature.'],
  ['Bleed', 'Necromancy', 'Will negates', 'yes', '', 'A dying creature loses 1 hit point and keeps bleeding.'],
  ['Create Water', 'Conjuration (creation) [water]', 'none', 'no', '', 'Creates 2 gallons of water per level.'],
  ['Dancing Lights', 'Evocation [light]', 'none', 'no', '', 'Up to four torch-like lights you move as you wish, 1 minute.'],
  ['Daze', 'Enchantment (compulsion) [mind-affecting]', 'Will negates', 'yes', '', 'A humanoid of 4 HD or less is dazed for 1 round.'],
  ['Detect Magic', 'Divination', 'none', 'no', 'cone:60', 'Detect spells and magic items within the cone; concentrate for more detail.'],
  ['Detect Poison', 'Divination', 'none', 'no', '', 'Detect poison in one creature, object or 5-ft. cube.'],
  ['Disrupt Undead', 'Necromancy', 'none', 'yes', '', 'Ray: 1d6 damage to one undead.'],
  ['Flare', 'Evocation [light]', 'Fortitude negates', 'yes', '', 'One creature is dazzled for 1 minute.'],
  ['Ghost Sound', 'Illusion (figment)', 'Will disbelief', 'no', '', 'Figment sounds, as loud as four humans per level (max 40).'],
  ['Guidance', 'Divination', HARMLESS, 'yes', '', '+1 competence bonus on one attack roll, saving throw or skill check.'],
  ['Light', 'Evocation [light]', 'none', 'no', '', 'An object sheds normal light in a 20-ft. radius for 10 minutes per level.'],
  ['Mage Hand', 'Transmutation', 'none', 'no', '', 'Move an unattended object of up to 5 lbs. by telekinesis.'],
  ['Mending', 'Transmutation', 'Will negates (harmless, object)', 'yes (harmless, object)', '', 'Repairs 1d4 points of damage to an object; can fix a broken one.'],
  ['Message', 'Transmutation [language-dependent]', 'none', 'no', '', 'Whispered conversation at a distance.'],
  ['Prestidigitation', 'Universal', 'see text', 'no', '', 'Minor tricks: clean, soil, chill, warm, flavor, color, small illusions.'],
  ['Ray of Frost', 'Evocation [cold]', 'none', 'yes', '', 'Ray: 1d3 cold damage.'],
  ['Read Magic', 'Divination', 'none', 'no', '', 'Read scrolls and spellbooks.'],
  ['Resistance', 'Abjuration', HARMLESS, SR_HARMLESS, '', '+1 resistance bonus on saving throws for 1 minute.'],
  ['Spark', 'Evocation [fire]', 'Fortitude negates (object)', 'yes (object)', '', 'Ignite a small flammable object.'],
  ['Stabilize', 'Conjuration (healing)', HARMLESS, SR_HARMLESS, '', 'A dying creature becomes stable.'],
  ['Virtue', 'Transmutation', 'none', SR_HARMLESS, '', 'The subject gains 1 temporary hit point.'],
  // 1st
  ['Bane', 'Enchantment (compulsion) [fear, mind-affecting]', 'Will negates', 'yes', 'burst:50', 'Enemies take −1 on attack rolls and on saves against fear.'],
  ['Bless', 'Enchantment (compulsion) [mind-affecting]', 'none', SR_HARMLESS, 'burst:50', 'Allies gain +1 morale on attack rolls and on saves against fear.'],
  ['Burning Hands', 'Evocation [fire]', 'Reflex half', 'yes', 'cone:15', '1d4 fire damage per caster level (max 5d4).'],
  ['Cause Fear', 'Necromancy [emotion, fear, mind-affecting]', 'Will partial', 'yes', '', 'One creature of 5 HD or less is frightened for 1d4 rounds (shaken for 1 round on a save).'],
  ['Charm Person', 'Enchantment (charm) [mind-affecting]', 'Will negates', 'yes', '', 'One humanoid regards you as a trusted friend.'],
  ['Color Spray', 'Illusion (pattern) [mind-affecting]', 'Will negates', 'yes', 'cone:15', 'Knocks creatures unconscious, blinds or stuns them depending on their HD.'],
  ['Command', 'Enchantment (compulsion) [language-dependent, mind-affecting]', 'Will negates', 'yes', '', 'One subject obeys a one-word command for 1 round.'],
  ['Cure Light Wounds', 'Conjuration (healing)', 'Will half (harmless)', SR_HARMLESS, '', 'Heals 1d8 + 1 per caster level (max +5); damages undead.'],
  ['Divine Favor', 'Evocation', 'none', 'no', '', '+1 luck bonus on attack and weapon damage rolls per three levels (min +1, max +3).'],
  ['Doom', 'Necromancy [emotion, fear, mind-affecting]', 'Will negates', 'yes', '', 'One subject is shaken.'],
  ['Enlarge Person', 'Transmutation', 'Fortitude negates', 'yes', '', 'A humanoid grows one size category: +2 Str, −2 Dex, −1 attack and AC.'],
  ['Entangle', 'Transmutation', 'Reflex partial', 'no', 'spread:40', 'Plants entangle everyone in the area.'],
  ['Expeditious Retreat', 'Transmutation', 'none', 'no', '', 'Your base land speed increases by 30 ft.'],
  ['Faerie Fire', 'Evocation [light]', 'none', 'yes', 'burst:5', 'Outlines creatures in light, negating concealment from blur, darkness and invisibility.'],
  ['Feather Fall', 'Transmutation', 'Will negates (harmless) or Will negates (object)', 'yes (object)', '', 'Objects or creatures fall slowly.'],
  ['Grease', 'Conjuration (creation)', 'Reflex partial (see text)', 'no', 'square:10', 'Makes a 10-ft. square or one object slippery.'],
  ['Identify', 'Divination', 'none', 'no', 'cone:60', '+10 bonus on Spellcraft checks to identify magic items.'],
  ['Inflict Light Wounds', 'Necromancy', 'Will half', 'yes', '', 'Touch: 1d8 + 1 per caster level (max +5) negative energy; heals undead.'],
  ['Mage Armor', 'Conjuration (creation) [force]', HARMLESS, 'no', '', '+4 armor bonus to AC for 1 hour per level.'],
  ['Magic Missile', 'Evocation [force]', 'none', 'yes', '', '1d4+1 force damage per missile; one missile, plus one per two levels above 1st (max 5).'],
  ['Obscuring Mist', 'Conjuration (creation)', 'none', 'no', 'spread:20', 'Fog spreads around you, granting concealment.'],
  ['Protection from Evil', 'Abjuration [good]', HARMLESS, 'no', '', '+2 deflection to AC and +2 resistance on saves against evil; blocks mental control.'],
  ['Ray of Enfeeblement', 'Necromancy', 'Fortitude half', 'yes', '', 'Ray: 1d6 Strength penalty, +1 per two levels (max +5).'],
  ['Reduce Person', 'Transmutation', 'Fortitude negates', 'yes', '', 'A humanoid shrinks one size category: −2 Str, +2 Dex, +1 attack and AC.'],
  ['Shield', 'Abjuration [force]', 'none', 'no', '', '+4 shield bonus to AC; negates magic missile attacks on you.'],
  ['Shield of Faith', 'Abjuration', HARMLESS, SR_HARMLESS, '', '+2 deflection bonus to AC, +1 per six levels (max +5).'],
  ['Silent Image', 'Illusion (figment)', 'Will disbelief (if interacted with)', 'no', '', 'A visual illusion of your design.'],
  ['Sleep', 'Enchantment (compulsion) [mind-affecting]', 'Will negates', 'yes', 'burst:10', 'Puts 4 HD of creatures into magical slumber.'],
  ['True Strike', 'Divination', 'none', 'no', '', '+20 insight bonus on your next single attack roll.'],
  // 2nd
  ['Acid Arrow', 'Conjuration (creation) [acid]', 'none', 'no', '', 'Ranged touch: 2d4 acid damage, again each round for 1 round per three levels.'],
  ['Aid', 'Enchantment (compulsion) [mind-affecting]', 'none', SR_HARMLESS, '', '+1 morale on attacks and saves against fear, 1d8 + 1 per level temporary hit points (max +10).'],
  ["Bear's Endurance", 'Transmutation', HARMLESS, 'yes', '', '+4 enhancement bonus to Constitution.'],
  ['Blindness/Deafness', 'Necromancy', 'Fortitude negates', 'yes', '', 'Makes the subject permanently blinded or deafened.'],
  ['Blur', 'Illusion (glamer)', HARMLESS, SR_HARMLESS, '', 'Attacks against the subject have a 20% miss chance.'],
  ["Bull's Strength", 'Transmutation', HARMLESS, 'yes', '', '+4 enhancement bonus to Strength.'],
  ["Cat's Grace", 'Transmutation', HARMLESS, 'yes', '', '+4 enhancement bonus to Dexterity.'],
  ['Cure Moderate Wounds', 'Conjuration (healing)', 'Will half (harmless)', SR_HARMLESS, '', 'Heals 2d8 + 1 per caster level (max +10); damages undead.'],
  ['Darkness', 'Evocation [darkness]', 'none', 'no', '', 'An object radiates darkness in a 20-ft. radius.'],
  ["Eagle's Splendor", 'Transmutation', HARMLESS, 'yes', '', '+4 enhancement bonus to Charisma.'],
  ['False Life', 'Necromancy', 'none', 'no', '', 'Gain 1d10 + 1 per level temporary hit points (max +10).'],
  ['Flaming Sphere', 'Evocation [fire]', 'Reflex negates', 'yes', '', 'A rolling ball of fire deals 3d6 fire damage; move it as a move action.'],
  ["Fox's Cunning", 'Transmutation', HARMLESS, 'yes', '', '+4 enhancement bonus to Intelligence.'],
  ['Glitterdust', 'Conjuration (creation)', 'Will negates (blinding only)', 'no', 'spread:10', 'Blinds creatures and outlines invisible things.'],
  ['Hold Person', 'Enchantment (compulsion) [mind-affecting]', 'Will negates', 'yes', '', 'One humanoid is paralyzed; a new save each round.'],
  ['Inflict Moderate Wounds', 'Necromancy', 'Will half', 'yes', '', 'Touch: 2d8 + 1 per caster level (max +10) negative energy; heals undead.'],
  ['Invisibility', 'Illusion (glamer)', 'Will negates (harmless) or Will negates (object)', 'yes (harmless) or yes (object)', '', 'The subject is invisible until it attacks.'],
  ['Lesser Restoration', 'Conjuration (healing)', HARMLESS, SR_HARMLESS, '', 'Dispels a magical ability penalty or heals 1d4 ability damage; removes fatigue.'],
  ['Mirror Image', 'Illusion (figment)', 'none', 'no', '', '1d4 images plus one per three levels (max 8) decoy attackers.'],
  ["Owl's Wisdom", 'Transmutation', HARMLESS, 'yes', '', '+4 enhancement bonus to Wisdom.'],
  ['Resist Energy', 'Abjuration', 'Fortitude negates (harmless)', SR_HARMLESS, '', 'Resist 10 against one energy type (20 at CL 7th, 30 at CL 11th).'],
  ['Scorching Ray', 'Evocation [fire]', 'none', 'yes', '', 'Ranged touch: 4d6 fire per ray; one ray, plus one at 7th and 11th level.'],
  ['See Invisibility', 'Divination', 'none', 'no', '', 'See invisible creatures and objects.'],
  ['Silence', 'Illusion (glamer)', 'Will negates; or none (object)', 'yes; or no (object)', 'emanation:20', 'Negates sound in the area.'],
  ['Sound Burst', 'Evocation [sonic]', 'Fortitude partial', 'yes', 'spread:10', '1d8 sonic damage; stunned for 1 round unless they save.'],
  ['Spiritual Weapon', 'Evocation [force]', 'none', 'yes', '', 'A magic weapon of force attacks on its own.'],
  ['Web', 'Conjuration (creation)', 'Reflex negates (see text)', 'no', 'spread:20', 'Fills the area with sticky spiderwebs that entangle.'],
  // 3rd
  ['Call Lightning', 'Evocation [electricity]', 'Reflex half', 'yes', '', 'Call down 3d6 electricity bolts, one per round.'],
  ['Cure Serious Wounds', 'Conjuration (healing)', 'Will half (harmless)', SR_HARMLESS, '', 'Heals 3d8 + 1 per caster level (max +15); damages undead.'],
  ['Daylight', 'Evocation [light]', 'none', 'no', '', 'An object sheds bright light in a 60-ft. radius.'],
  ['Deep Slumber', 'Enchantment (compulsion) [mind-affecting]', 'Will negates', 'yes', 'burst:10', 'Puts 10 HD of creatures to sleep.'],
  ['Dispel Magic', 'Abjuration', 'none', 'no', '', 'Cancels one spell or magical effect (caster level check).'],
  ['Displacement', 'Illusion (glamer)', HARMLESS, SR_HARMLESS, '', 'Attacks against the subject have a 50% miss chance.'],
  ['Fireball', 'Evocation [fire]', 'Reflex half', 'yes', 'spread:20', '1d6 fire damage per caster level (max 10d6).'],
  ['Fly', 'Transmutation', HARMLESS, SR_HARMLESS, '', 'The subject flies at a speed of 60 ft.'],
  ['Haste', 'Transmutation', 'Fortitude negates (harmless)', SR_HARMLESS, '', 'One creature per level: one extra attack on a full attack, +1 attack, AC and Reflex, +30 ft. speed.'],
  ['Heroism', 'Enchantment (compulsion) [mind-affecting]', HARMLESS, SR_HARMLESS, '', '+2 morale bonus on attack rolls, saves and skill checks.'],
  ['Inflict Serious Wounds', 'Necromancy', 'Will half', 'yes', '', 'Touch: 3d8 + 1 per caster level (max +15) negative energy; heals undead.'],
  ['Lightning Bolt', 'Evocation [electricity]', 'Reflex half', 'yes', 'line:120', '1d6 electricity damage per caster level (max 10d6).'],
  ['Prayer', 'Enchantment (compulsion) [mind-affecting]', 'none', 'yes', 'burst:40', 'Allies +1 luck on attacks, weapon damage, saves and skills; enemies −1.'],
  ['Protection from Energy', 'Abjuration', 'Fortitude negates (harmless)', SR_HARMLESS, '', 'Absorbs 12 points per level (max 120) of one energy type.'],
  ['Remove Curse', 'Abjuration', HARMLESS, SR_HARMLESS, '', 'Frees an object or person from a curse (caster level check).'],
  ['Searing Light', 'Evocation [light]', 'none', 'yes', '', 'Ray: 1d8 per two levels (max 5d8); more against undead and light-sensitive creatures.'],
  ['Slow', 'Transmutation', 'Will negates', 'yes', '', 'One creature per level: staggered, −1 on attacks, AC and Reflex, half speed.'],
  ['Stinking Cloud', 'Conjuration (creation) [poison]', 'Fortitude negates', 'no', 'spread:20', 'Nauseating vapors, 1 round per level.'],
  ['Vampiric Touch', 'Necromancy', 'none', 'yes', '', 'Touch: 1d6 per two levels (max 10d6); you gain the damage as temporary hit points.'],
  // 4th
  ['Black Tentacles', 'Conjuration (creation)', 'none', 'no', 'spread:20', 'Tentacles grapple everyone in the area.'],
  ['Confusion', 'Enchantment (compulsion) [mind-affecting]', 'Will negates', 'yes', 'burst:15', 'Subjects behave oddly for 1 round per level.'],
  ['Cure Critical Wounds', 'Conjuration (healing)', 'Will half (harmless)', SR_HARMLESS, '', 'Heals 4d8 + 1 per caster level (max +20); damages undead.'],
  ['Dimension Door', 'Conjuration (teleportation)', 'none and Will negates (object)', 'no and yes (object)', '', 'Teleports you (and touched creatures) a short distance.'],
  ['Divine Power', 'Evocation', 'none', 'no', '', 'You gain luck bonuses to attack, damage, Strength checks and skills, and temporary hit points.'],
  ['Fear', 'Necromancy [emotion, fear, mind-affecting]', 'Will partial', 'yes', 'cone:30', 'Subjects in the cone flee for 1 round per level (shaken for 1 round on a save).'],
  ['Fire Shield', 'Evocation [fire or cold]', 'none', 'no', '', 'Creatures attacking you take fire (or cold) damage; you are protected from the other.'],
  ['Freedom of Movement', 'Abjuration', HARMLESS, SR_HARMLESS, '', 'The subject moves normally despite impediments.'],
  ['Greater Invisibility', 'Illusion (glamer)', HARMLESS, SR_HARMLESS, '', 'As invisibility, but the subject can attack and stay invisible.'],
  ['Holy Smite', 'Evocation [good]', 'Will partial (see text)', 'yes', 'burst:20', 'Damages and blinds evil creatures.'],
  ['Ice Storm', 'Evocation [cold]', 'none', 'yes', 'cylinder:20', 'Hail deals 3d6 bludgeoning and 2d6 cold damage.'],
  ['Inflict Critical Wounds', 'Necromancy', 'Will half', 'yes', '', 'Touch: 4d8 + 1 per caster level (max +20) negative energy; heals undead.'],
  ['Restoration', 'Conjuration (healing)', HARMLESS, SR_HARMLESS, '', 'Restores level and ability score drain.'],
  ['Stoneskin', 'Abjuration', HARMLESS, SR_HARMLESS, '', 'Grants DR 10/adamantine.'],
  // 5th
  ['Break Enchantment', 'Abjuration', 'see text', 'no', '', 'Frees subjects from enchantments, transmutations and curses.'],
  ['Cloudkill', 'Conjuration (creation) [poison]', 'Fortitude partial (see text)', 'no', 'spread:20', 'Kills 3 HD or less; 4-6 HD save or die; 6+ HD take Con damage.'],
  ['Cone of Cold', 'Evocation [cold]', 'Reflex half', 'yes', 'cone:60', '1d6 cold damage per caster level (max 15d6).'],
  ['Flame Strike', 'Evocation [fire]', 'Reflex half', 'yes', 'cylinder:10', '1d6 damage per caster level (max 15d6), half fire and half divine.'],
  ['Hold Monster', 'Enchantment (compulsion) [mind-affecting]', 'Will negates', 'yes', '', 'As hold person, but any creature.'],
  ['Raise Dead', 'Conjuration (healing)', 'none (see text)', SR_HARMLESS, '', 'Restores life to a creature dead no longer than 1 day per level.'],
  ['Teleport', 'Conjuration (teleportation)', 'none and Will negates (object)', 'no and yes (object)', '', 'Instantly transports you as far as 100 miles per level.'],
  // 6th+
  ['Chain Lightning', 'Evocation [electricity]', 'Reflex half', 'yes', '', '1d6 electricity per level (max 20d6) to the primary and secondary targets (secondary targets get +2 on the Reflex save).'],
  ['Disintegrate', 'Transmutation', 'Fortitude partial (object)', 'yes', '', 'Ray: 2d6 per level (max 40d6); 5d6 on a save.'],
  ['Harm', 'Necromancy', 'Will half', 'yes', '', 'Touch: 10 points per level (max 150) negative energy damage.'],
  ['Heal', 'Conjuration (healing)', HARMLESS, SR_HARMLESS, '', 'Cures 10 points per level (max 150) and many conditions.'],
  ['Delayed Blast Fireball', 'Evocation [fire]', 'Reflex half', 'yes', 'spread:20', '1d6 fire damage per caster level (max 20d6); can be delayed up to 5 rounds.'],
  ['Finger of Death', 'Necromancy [death]', 'Fortitude partial', 'yes', '', '10 damage per caster level; 3d6 + 1 per level on a save.'],
  ['Prismatic Spray', 'Evocation', 'see text', 'yes', 'cone:60', 'Rays of light hit subjects with a variety of effects.'],
  ['Meteor Swarm', 'Evocation [fire]', 'none or Reflex half (see text)', 'yes', 'spread:40', 'Four meteors: 2d6 bludgeoning on a direct hit, and 6d6 fire in a 40-ft.-radius spread each.'],
  ['Time Stop', 'Transmutation', 'none', 'no', '', 'You act freely for 1d4+1 rounds.'],
  // Mass cures and inflicts (spontaneous conversion at higher levels)
  ['Mass Cure Light Wounds', 'Conjuration (healing)', 'Will half (harmless) or Will half', 'yes (harmless) or yes', '', 'One creature per level: heals 1d8 + 1 per level (max +25).'],
  ['Mass Cure Moderate Wounds', 'Conjuration (healing)', 'Will half (harmless) or Will half', 'yes (harmless) or yes', '', 'One creature per level: heals 2d8 + 1 per level (max +30).'],
  ['Mass Cure Serious Wounds', 'Conjuration (healing)', 'Will half (harmless) or Will half', 'yes (harmless) or yes', '', 'One creature per level: heals 3d8 + 1 per level (max +35).'],
  ['Mass Cure Critical Wounds', 'Conjuration (healing)', 'Will half (harmless) or Will half', 'yes (harmless) or yes', '', 'One creature per level: heals 4d8 + 1 per level (max +40).'],
  ['Mass Inflict Light Wounds', 'Necromancy', 'Will half', 'yes', '', 'One creature per level: 1d8 + 1 per level (max +25) negative energy.'],
  ['Mass Inflict Moderate Wounds', 'Necromancy', 'Will half', 'yes', '', 'One creature per level: 2d8 + 1 per level (max +30) negative energy.'],
  ['Mass Inflict Serious Wounds', 'Necromancy', 'Will half', 'yes', '', 'One creature per level: 3d8 + 1 per level (max +35) negative energy.'],
  ['Mass Inflict Critical Wounds', 'Necromancy', 'Will half', 'yes', '', 'One creature per level: 4d8 + 1 per level (max +40) negative energy.'],
];

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX'];
for (const [i, r] of ROMAN.entries()) {
  SPELL_ROWS.push([`Summon Monster ${r}`, 'Conjuration (summoning)', 'none', 'no', '', `Summons an extraplanar creature from the level ${i + 1} list (or more from lower lists).`]);
  SPELL_ROWS.push([`Summon Nature's Ally ${r}`, 'Conjuration (summoning)', 'none', 'no', '', `Summons a natural creature from the level ${i + 1} list (or more from lower lists).`]);
}

const SPELLS = new Map<string, SpellRef>(
  SPELL_ROWS.map(([name, school, save, sr, area, text]) => {
    const [shape, ft] = area.split(':');
    return [normalizeName(name), { name, school, save, sr, area: shape && ft ? AREA_SHAPES[shape]!(Number(ft)) : null, text }];
  }),
);

const VARIANT = /^(.+?)\s*(?:\(\s*(greater|lesser|mass|communal)\s*\)|,\s*(greater|lesser|mass|communal))$/i;

/**
 * "Invisibility (Greater)" (PCGen Pathfinder data), "Invisibility, Greater"
 * (3.5-style) -> ["Invisibility", "Greater"]; anything else -> [name, null].
 */
function splitVariant(name: string): [string, string | null] {
  const m = VARIANT.exec(name.trim());
  return m ? [m[1]!.trim(), (m[2] ?? m[3])!] : [name.trim(), null];
}

/**
 * Reference data for a spell, if the curated table has it. A Greater/Lesser/
 * Mass/Communal variant only matches that variant (never the base spell, whose
 * numbers differ); other trailing parentheses ("Fireball (EB)") are ignored.
 */
export function lookupSpell(name: string): SpellRef | undefined {
  const [base, variant] = splitVariant(name);
  if (variant) return SPELLS.get(normalizeName(`${variant} ${base}`));
  return SPELLS.get(normalizeName(base.replace(/\(.*\)$/, '')));
}

/** The school word ("Evocation") of a spell, for Spell Focus. Variants share their base spell's school. */
export function spellSchool(name: string): string | null {
  const ref = lookupSpell(name) ?? lookupSpell(splitVariant(name)[0]);
  return ref?.school.split(/[\s(]/)[0] ?? null;
}

const CURE = ['Cure Light Wounds', 'Cure Moderate Wounds', 'Cure Serious Wounds', 'Cure Critical Wounds', 'Mass Cure Light Wounds', 'Mass Cure Moderate Wounds', 'Mass Cure Serious Wounds', 'Mass Cure Critical Wounds'];
const INFLICT = CURE.map((n) => n.replace('Cure', 'Inflict'));

/**
 * The spell a prepared spell of `level` converts into: the highest cure/inflict
 * spell of that level or lower (Mass Cure Critical Wounds for 9th), or
 * Summon Nature's Ally of the same level. Returns [name, its own spell level].
 */
export function conversionSpell(kind: 'cure' | 'inflict' | 'sna', level: number): [string, number] | null {
  if (level < 1 || level > 9) return null;
  if (kind === 'sna') return [`Summon Nature's Ally ${ROMAN[level - 1]}`, level];
  const list = kind === 'cure' ? CURE : INFLICT;
  const l = Math.min(level, list.length);
  return [list[l - 1]!, l];
}
