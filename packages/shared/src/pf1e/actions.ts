/**
 * PF1e combat actions as data, transcribed from
 * pathfinder_1e_level_1_actions_reference.md: generic actions every character
 * can take, and level-1 class actions with their daily resources.
 */
import { normalizeName, type StatKey } from './rules';

/** Which slot of the turn an action uses. 'other' = out of combat time (1 minute, varies...). */
export type ActionCost = 'standard' | 'move' | 'fullRound' | 'swift' | 'immediate' | 'free' | 'none' | 'fiveFoot' | 'aoo' | 'other';
export type Provokes = 'yes' | 'no' | 'varies' | 'ranged';
export type ActionGroup = 'standard' | 'move' | 'fullRound' | 'maneuver' | 'other';

export interface Pf1Action {
  id: string;
  name: string;
  cost: ActionCost;
  /** Shown instead of the cost name when the action is more nuanced ("Standard, or Move for one target"). */
  costLabel?: string;
  provokes: Provokes;
  notes: string;
  group?: ActionGroup;
  /** Counts as moving (no 5-foot step that turn). */
  movement?: boolean;
  /** Spends uses of this resource id (default 1; see resourceCost). */
  resource?: string;
  /** Uses of `resource` spent per activation (default 1). */
  resourceCost?: number;
  /** Offer a matching roll button. */
  roll?: 'melee' | 'ranged' | 'cmb';
}

export const COST_LABEL: Record<ActionCost, string> = {
  standard: 'Standard',
  move: 'Move',
  fullRound: 'Full-round',
  swift: 'Swift',
  immediate: 'Immediate',
  free: 'Free',
  none: 'No action',
  fiveFoot: '5-ft step',
  aoo: 'Attack of opportunity',
  other: 'Out of combat',
};

const g = (
  id: string,
  name: string,
  group: ActionGroup,
  cost: ActionCost,
  provokes: Provokes,
  notes: string,
  extra: Partial<Pf1Action> = {},
): Pf1Action => ({ id: `g.${id}`, name, group, cost, provokes, notes, ...extra });

// ------------------------------------------------------------------ generic actions

export const GENERIC_ACTIONS: Pf1Action[] = [
  // Standard
  g('attack', 'Attack', 'standard', 'standard', 'ranged', 'One attack at your highest BAB. Ranged and unarmed (without Improved Unarmed Strike) provoke. May Fight Defensively: −4 to attack, +2 dodge AC.', { roll: 'melee' }),
  g('aid', 'Aid Another', 'standard', 'standard', 'varies', 'Attack vs AC 10 (or DC 10 check) to give an ally +2 on their next attack, +2 AC vs one foe, or +2 on a skill check.'),
  g('cast', 'Cast a Spell', 'standard', 'standard', 'yes', 'Most spells take a standard action. Cast defensively (Concentration DC 15 + 2× spell level) to avoid provoking.'),
  g('concentrate', 'Concentrate on a Spell', 'standard', 'standard', 'no', 'Required each round to maintain a spell with duration "Concentration".'),
  g('dismiss', 'Dismiss a Spell', 'standard', 'standard', 'no', 'End a dismissible (D) spell you cast.'),
  g('item', 'Activate Magic Item', 'standard', 'standard', 'varies', 'Scrolls (spell completion) provoke; wands, staves, command-word and use-activated items do not.'),
  g('potion', 'Drink Potion / Apply Oil', 'standard', 'standard', 'yes', 'Drink a potion or apply an oil.'),
  g('poison', 'Apply Poison', 'standard', 'standard', 'yes', 'Poison a weapon or one piece of ammunition (5% chance to poison yourself without Poison Use).'),
  g('escape', 'Escape a Grapple', 'standard', 'standard', 'no', 'Combat maneuver check or Escape Artist check to break free.', { roll: 'cmb' }),
  g('lowersr', 'Lower Spell Resistance', 'standard', 'standard', 'no', 'Lower your SR until your next turn.'),
  g('feint', 'Feint', 'standard', 'standard', 'no', 'Bluff vs DC 10 + BAB + Wis (or 10 + Sense Motive if trained, whichever is higher) to deny the target its Dex to AC against your next melee attack.'),
  g('totaldefense', 'Total Defense', 'standard', 'standard', 'no', '+4 dodge bonus to AC until your next turn; you can’t make attacks of opportunity.'),
  g('ready', 'Ready an Action', 'standard', 'standard', 'no', 'Set a trigger for a standard, move, swift or free action. Your initiative moves to just before the triggering creature.'),
  g('restricted', 'Restricted Charge / Withdraw', 'standard', 'standard', 'no', 'Only when limited to a single standard action (surprise round, staggered): move up to your speed.', { movement: true }),
  g('startfull', 'Start / Complete Full-Round Action', 'standard', 'standard', 'varies', 'Spend a standard action this turn and next to complete a full-round action (not Full Attack, Charge, Run or Withdraw).'),
  g('skill', 'Use a Skill', 'standard', 'standard', 'varies', 'Most active skills (Heal first aid provokes; Intimidate to demoralize does not).'),
  g('special', 'Use a Special Ability', 'standard', 'standard', 'varies', 'Spell-like abilities (Sp) provoke; supernatural (Su) and extraordinary (Ex) abilities do not.'),
  // Move
  g('move', 'Move', 'move', 'move', 'yes', 'Move up to your speed. Leaving a threatened square provokes.', { movement: true }),
  g('crawl', 'Crawl', 'move', 'move', 'yes', 'Move 5 feet while prone.', { movement: true }),
  g('standup', 'Stand Up', 'move', 'move', 'yes', 'Stand up from prone.'),
  g('draw', 'Draw a Weapon', 'move', 'move', 'no', 'With BAB +1 or higher you can do this as part of a move.'),
  g('sheathe', 'Sheathe a Weapon', 'move', 'move', 'yes', 'Put away a held weapon.'),
  g('shield', 'Ready / Loose a Shield', 'move', 'move', 'no', 'With BAB +1 or higher you can do this as part of a move.'),
  g('door', 'Open or Close a Door', 'move', 'move', 'no', 'An unlocked door.'),
  g('manipulate', 'Manipulate an Item', 'move', 'move', 'yes', 'Pick up an item, retrieve a stored item, move a heavy object.'),
  g('mount', 'Mount / Dismount', 'move', 'move', 'no', 'Must be adjacent to the mount.'),
  g('controlmount', 'Control a Frightened Mount', 'move', 'move', 'no', 'Ride check.'),
  g('loadlight', 'Load Light / Hand Crossbow', 'move', 'move', 'yes', 'Heavy and repeating crossbows take a full-round action.'),
  g('loadsling', 'Load a Sling', 'move', 'move', 'yes', 'Needs two hands.'),
  g('direct', 'Direct / Redirect a Spell', 'move', 'move', 'no', 'Move or retarget an active spell such as Flaming Sphere or Spiritual Weapon.'),
  // Full-round
  g('fullattack', 'Full Attack', 'fullRound', 'fullRound', 'ranged', 'All your attacks (iteratives, two-weapon fighting, flurry, natural attacks). Ranged attacks provoke. May Fight Defensively.', { roll: 'melee' }),
  g('charge', 'Charge', 'fullRound', 'fullRound', 'no', 'Move up to 2× speed in a straight line (min 10 ft) and make one melee attack at +2; −2 AC until your next turn. Movement can still provoke.', { movement: true, roll: 'melee' }),
  g('run', 'Run', 'fullRound', 'fullRound', 'yes', 'Move 4× speed in a straight line (3× in heavy armor); lose your Dex bonus to AC until your next turn.', { movement: true }),
  g('withdraw', 'Withdraw', 'fullRound', 'fullRound', 'no', 'Move up to 2× speed; the square you start in isn’t threatened by enemies you can see.', { movement: true }),
  g('coupdegrace', 'Coup de Grace', 'fullRound', 'fullRound', 'yes', 'Auto-hit, auto-crit on a helpless target; it must make a Fort save (DC 10 + damage) or die.'),
  g('cast1round', 'Cast a 1-Round Spell', 'fullRound', 'fullRound', 'yes', 'Takes effect just before your next turn. Metamagic on a spontaneous standard-action spell also makes it full-round.'),
  g('touch6', 'Touch Spell on Up to Six Friends', 'fullRound', 'fullRound', 'yes', 'Deliver a beneficial touch spell to up to six willing targets.'),
  g('loadheavy', 'Load Heavy / Repeating Crossbow', 'fullRound', 'fullRound', 'yes', 'Reload a heavy crossbow or change a repeating crossbow’s case.'),
  g('gauntlet', 'Lock / Unlock Locked Gauntlet', 'fullRound', 'fullRound', 'yes', 'Secure or release a weapon in a locked gauntlet.'),
  g('splash', 'Prepare Splash Weapon', 'fullRound', 'fullRound', 'yes', 'Prepare a splash weapon such as a flask of oil before throwing it.'),
  g('extinguish', 'Extinguish Flames', 'fullRound', 'fullRound', 'no', 'DC 15 Reflex save to put out fire on yourself; dropping prone and rolling gives +4.'),
  g('fullskill', 'Escape a Net / Full-Round Skill', 'fullRound', 'fullRound', 'yes', 'Escape Artist vs a net, or any skill that takes a full round.'),
  // Combat maneuvers (provoke unless you have the matching Improved feat)
  g('disarm', 'Disarm', 'maneuver', 'standard', 'yes', 'Replaces a melee attack (in an Attack, Full Attack, Charge or AoO). Provokes without Improved Disarm.', { roll: 'cmb' }),
  g('sunder', 'Sunder', 'maneuver', 'standard', 'yes', 'Replaces a melee attack. Provokes without Improved Sunder.', { roll: 'cmb' }),
  g('trip', 'Trip', 'maneuver', 'standard', 'yes', 'Replaces a melee attack. Provokes without Improved Trip.', { roll: 'cmb' }),
  g('bullrush', 'Bull Rush', 'maneuver', 'standard', 'yes', 'Also usable at the end of a charge. Provokes without Improved Bull Rush.', { roll: 'cmb' }),
  g('dirtytrick', 'Dirty Trick', 'maneuver', 'standard', 'yes', 'Provokes without Improved Dirty Trick.', { roll: 'cmb' }),
  g('drag', 'Drag', 'maneuver', 'standard', 'yes', 'Provokes without Improved Drag.', { roll: 'cmb' }),
  g('grapple', 'Grapple', 'maneuver', 'standard', 'yes', 'Provokes without Improved Grapple.', { roll: 'cmb' }),
  g('overrun', 'Overrun', 'maneuver', 'standard', 'yes', 'Standard action taken during your move, or part of a charge. Provokes without Improved Overrun.', { movement: true, roll: 'cmb' }),
  g('reposition', 'Reposition', 'maneuver', 'standard', 'yes', 'Provokes without Improved Reposition.', { roll: 'cmb' }),
  g('steal', 'Steal', 'maneuver', 'standard', 'yes', 'Provokes without Improved Steal.', { roll: 'cmb' }),
  // Free / non-actions
  g('fivefoot', '5-Foot Step', 'other', 'fiveFoot', 'no', 'Move 5 feet without provoking. Once per turn, and only if you don’t otherwise move.', { movement: false }),
  g('aoo', 'Attack of Opportunity', 'other', 'aoo', 'no', 'A melee attack when a foe in your threatened area provokes. Once per round (more with Combat Reflexes); not while flat-footed.', { roll: 'melee' }),
  g('delay', 'Delay', 'other', 'none', 'no', 'Act later in the round (use ↑/↓ in the Combat panel).'),
  g('drop', 'Drop an Item / Drop Prone / Speak', 'other', 'free', 'no', 'Free actions; don’t provoke.'),
  g('cease', 'Cease Concentration', 'other', 'free', 'no', 'End a concentration-duration spell.'),
];

// ------------------------------------------------------------------ class actions & resources

export interface ResourceCtx {
  /** Level in this class. */
  level: number;
  mod: (k: StatKey) => number;
}

export interface ResourceDef {
  id: string;
  name: string;
  unit: 'uses' | 'rounds' | 'points' | 'minutes';
  max: (ctx: ResourceCtx) => number;
}

export interface ClassActionSet {
  className: string;
  /** Normalized class names this applies to (see normalizeName). */
  keys: string[];
  resources: ResourceDef[];
  actions: Pf1Action[];
}

const res = (id: string, name: string, unit: ResourceDef['unit'], max: ResourceDef['max']): ResourceDef => ({ id, name, unit, max });
const ca = (cls: string, id: string, name: string, cost: ActionCost, provokes: Provokes, notes: string, extra: Partial<Pf1Action> = {}): Pf1Action => ({
  id: `c.${cls}.${id}`,
  name,
  cost,
  provokes,
  notes,
  ...extra,
});
const atLeast1 = (n: number) => Math.max(1, n);
const every3 = (l: number) => 1 + Math.floor((l - 1) / 3); // 1/day at 1st, +1 at 4th, 7th...

const castSpell = (cls: string, kind: string) => ca(cls, 'cast', 'Cast a Spell', 'other', 'varies', kind, { costLabel: 'Varies' });
const wildEmpathy = (cls: string) =>
  ca(cls, 'empathy', 'Wild Empathy', 'other', 'no', 'Diplomacy-like check (1d20 + level + Cha) to improve an animal’s attitude. Takes 1 minute.', { costLabel: '1 minute' });

export const CLASS_ACTIONS: ClassActionSet[] = [
  // ---------------- Core
  {
    className: 'Barbarian',
    keys: ['barbarian'],
    resources: [res('rage', 'Rage', 'rounds', ({ level, mod }) => 4 + mod('CON') + 2 * (level - 1))],
    actions: [ca('barbarian', 'rage', 'Rage (1 round)', 'free', 'no', 'Enter or continue rage: +4 Str, +4 Con, +2 Will, −2 AC. Spend 1 round per round raging.', { resource: 'rage' })],
  },
  {
    className: 'Unchained Barbarian',
    keys: ['barbarianunchained', 'unchainedbarbarian'],
    resources: [res('rage', 'Rage', 'rounds', ({ level, mod }) => 4 + mod('CON') + 2 * (level - 1))],
    actions: [
      ca('ubarbarian', 'rage', 'Rage (1 round)', 'free', 'no', '+2 melee attack and damage, +2 thrown damage, +2 Will, −2 AC, 2 temp HP per HD (not again within 1 minute).', { resource: 'rage' }),
    ],
  },
  {
    className: 'Bard',
    keys: ['bard'],
    resources: [res('performance', 'Bardic Performance', 'rounds', ({ level, mod }) => 4 + mod('CHA') + 2 * (level - 1))],
    actions: [
      ca('bard', 'perform', 'Start Bardic Performance', 'standard', 'no', 'Countersong, Distraction, Fascinate or Inspire Courage (+1). Spends 1 round.', { resource: 'performance' }),
      ca('bard', 'maintain', 'Maintain Performance (1 round)', 'free', 'no', 'Keep a performance going for another round.', { resource: 'performance' }),
      castSpell('bard', 'Spontaneous arcane (cantrips, 1st level).'),
    ],
  },
  {
    className: 'Cleric',
    keys: ['cleric'],
    resources: [res('channel', 'Channel Energy', 'uses', ({ mod }) => 3 + mod('CHA')), res('domain', 'Domain powers', 'uses', ({ mod }) => 3 + mod('WIS'))],
    actions: [
      ca('cleric', 'channel', 'Channel Energy', 'standard', 'no', '30-ft burst: heal or harm 1d6 (+1d6 per two levels after 1st).', { resource: 'channel' }),
      ca('cleric', 'domain', 'Domain Power', 'other', 'varies', 'One of your two 1st-level domain powers (usually standard or swift).', { costLabel: 'Varies', resource: 'domain' }),
      castSpell('cleric', 'Prepared divine (orisons, 1st level); can spontaneously cast cure or inflict.'),
    ],
  },
  {
    className: 'Druid',
    keys: ['druid'],
    resources: [],
    actions: [
      ca('druid', 'handle', 'Handle Animal (companion)', 'free', 'no', 'Free for a known trick; a move action to push.', { costLabel: 'Free (trick) / Move (push)' }),
      wildEmpathy('druid'),
      castSpell('druid', 'Prepared divine (orisons, 1st level); can spontaneously cast summon nature’s ally.'),
    ],
  },
  {
    className: 'Monk',
    keys: ['monk'],
    resources: [res('stunning', 'Stunning Fist', 'uses', ({ level }) => level)],
    actions: [
      ca('monk', 'flurry', 'Flurry of Blows', 'fullRound', 'no', 'One extra unarmed/monk weapon attack; BAB = monk level, −2 on all attacks.', { roll: 'melee' }),
      ca('monk', 'stunning', 'Stunning Fist', 'none', 'no', 'Declare before the attack (max 1/round): Fort DC 10 + ½ level + Wis or stunned 1 round.', { resource: 'stunning' }),
    ],
  },
  {
    className: 'Unchained Monk',
    keys: ['monkunchained', 'unchainedmonk'],
    resources: [res('stunning', 'Stunning Fist', 'uses', ({ level }) => level)],
    actions: [
      ca('umonk', 'flurry', 'Flurry of Blows', 'fullRound', 'no', 'One extra attack at full BAB with no penalty.', { roll: 'melee' }),
      ca('umonk', 'stunning', 'Stunning Fist', 'none', 'no', 'Declare before the attack (max 1/round): Fort DC 10 + ½ level + Wis or stunned 1 round.', { resource: 'stunning' }),
    ],
  },
  {
    className: 'Paladin',
    keys: ['paladin'],
    resources: [res('smite', 'Smite Evil', 'uses', ({ level }) => every3(level))],
    actions: [
      ca('paladin', 'detect', 'Detect Evil', 'move', 'no', 'At will. Move action to study one target, or standard action as the spell.', { costLabel: 'Move (one target) / Standard' }),
      ca('paladin', 'smite', 'Smite Evil', 'swift', 'no', '+Cha to attack and deflection AC, +level damage vs one evil target; bypasses DR. Double damage on first hit vs evil outsiders, dragons, undead.', { resource: 'smite' }),
    ],
  },
  { className: 'Ranger', keys: ['ranger'], resources: [], actions: [wildEmpathy('ranger')] },
  {
    className: 'Sorcerer',
    keys: ['sorcerer'],
    resources: [res('bloodline', 'Bloodline power', 'uses', ({ mod }) => 3 + mod('CHA'))],
    actions: [
      ca('sorcerer', 'bloodline', 'Bloodline Power', 'standard', 'varies', 'Your 1st-level bloodline power (usually a standard action).', { costLabel: 'Usually Standard', resource: 'bloodline' }),
      castSpell('sorcerer', 'Spontaneous arcane (cantrips, 1st level).'),
    ],
  },
  {
    className: 'Wizard',
    keys: ['wizard'],
    resources: [res('bond', 'Arcane Bond', 'uses', () => 1), res('school', 'School power', 'uses', ({ mod }) => 3 + mod('INT'))],
    actions: [
      ca('wizard', 'bond', 'Arcane Bond (bonded object)', 'other', 'varies', 'Cast any spell from your spellbook without preparing it (no metamagic, no opposition schools).', { costLabel: 'Spell’s casting time', resource: 'bond' }),
      ca('wizard', 'school', 'Arcane School Power', 'standard', 'varies', 'Your 1st-level school power (usually a standard action).', { costLabel: 'Usually Standard', resource: 'school' }),
      castSpell('wizard', 'Prepared arcane (cantrips, 1st level).'),
    ],
  },
  // ---------------- Base
  {
    className: 'Alchemist',
    keys: ['alchemist'],
    resources: [res('bombs', 'Bombs', 'uses', ({ level, mod }) => level + mod('INT'))],
    actions: [
      ca('alchemist', 'bomb', 'Throw Bomb', 'standard', 'yes', 'Ranged touch: 1d6 + Int fire damage (+1d6 per two levels after 1st) plus splash.', { resource: 'bombs', roll: 'ranged' }),
      ca('alchemist', 'mutagen', 'Drink Mutagen', 'standard', 'yes', '+4 alchemical to one physical ability, −2 to its mental pair, +2 natural armor for 10 min/level. Takes 1 hour to brew.'),
      ca('alchemist', 'extract', 'Drink Extract', 'standard', 'yes', 'Works like a personal-range spell of the extract’s level.'),
    ],
  },
  {
    className: 'Cavalier',
    keys: ['cavalier'],
    resources: [res('challenge', 'Challenge', 'uses', ({ level }) => every3(level)), res('tactician', 'Tactician', 'uses', ({ level }) => 1 + Math.floor(level / 5))],
    actions: [
      ca('cavalier', 'challenge', 'Challenge', 'swift', 'no', '+level damage vs the challenged foe; −2 AC against everyone else.', { resource: 'challenge' }),
      ca('cavalier', 'tactician', 'Tactician', 'standard', 'no', 'Allies within 30 ft gain your teamwork feat for 3 rounds + 1 round per two levels.', { resource: 'tactician' }),
      ca('cavalier', 'mount', 'Handle Mount', 'move', 'no', 'Handle Animal to direct or push your combat-trained mount.', { costLabel: 'Move (push)' }),
    ],
  },
  {
    className: 'Gunslinger',
    keys: ['gunslinger'],
    resources: [res('grit', 'Grit', 'points', ({ mod }) => atLeast1(mod('WIS')))],
    actions: [
      ca('gunslinger', 'deadeye', 'Deadeye', 'none', 'no', 'Spend 1 grit per range increment past the first to resolve a firearm attack against touch AC.', { resource: 'grit' }),
      ca('gunslinger', 'dodge', 'Gunslinger’s Dodge', 'immediate', 'varies', 'When targeted by a ranged attack: move 5 ft (+2 AC; provokes, not a 5-foot step) or drop prone (+4 AC). Light/medium armor and light load.', { resource: 'grit' }),
      ca('gunslinger', 'quickclear', 'Quick Clear', 'standard', 'no', 'Remove the broken condition from a misfired firearm (standard with ≥1 grit, or move by spending 1 grit).', { costLabel: 'Standard / Move (1 grit)' }),
    ],
  },
  {
    className: 'Inquisitor',
    keys: ['inquisitor'],
    resources: [res('judgment', 'Judgment', 'uses', ({ level }) => every3(level))],
    actions: [
      ca('inquisitor', 'judgment', 'Judgment', 'swift', 'no', 'Start a judgment (destruction, healing, justice, piercing, protection, purity, resiliency, resistance, smiting). Switching type later is also a swift action and costs no use.', { resource: 'judgment' }),
      ca('inquisitor', 'switch', 'Switch Judgment Type', 'swift', 'no', 'Change the active judgment without spending a use.'),
      ca('inquisitor', 'domain', 'Domain / Inquisition Power', 'other', 'varies', 'As cleric domain powers.', { costLabel: 'Varies' }),
      castSpell('inquisitor', 'Spontaneous divine (orisons, 1st level).'),
    ],
  },
  {
    className: 'Magus',
    keys: ['magus'],
    resources: [res('arcanepool', 'Arcane Pool', 'points', ({ level, mod }) => atLeast1(Math.floor(level / 2)) + mod('INT'))],
    actions: [
      ca('magus', 'pool', 'Arcane Pool: Enhance Weapon', 'swift', 'no', '+1 enhancement to a held weapon for 1 minute.', { resource: 'arcanepool' }),
      ca('magus', 'spellcombat', 'Spell Combat', 'fullRound', 'varies', 'Cast a magus spell (standard-action casting time) and make melee attacks, all at −2. One hand free, light or one-handed weapon in the other.', { roll: 'melee' }),
      castSpell('magus', 'Prepared arcane (cantrips, 1st level).'),
    ],
  },
  {
    className: 'Oracle',
    keys: ['oracle'],
    resources: [],
    actions: [
      ca('oracle', 'revelation', 'Revelation', 'other', 'varies', 'Your 1st-level mystery revelation.', { costLabel: 'Varies' }),
      castSpell('oracle', 'Spontaneous divine (orisons, 1st level).'),
    ],
  },
  {
    className: 'Summoner',
    keys: ['summoner', 'summonerunchained', 'unchainedsummoner'],
    resources: [res('summon', 'Summon Monster', 'uses', ({ mod }) => 3 + mod('CHA'))],
    actions: [
      ca('summoner', 'eidolon', 'Summon Eidolon', 'other', 'no', 'A 1-minute ritual to call your eidolon.', { costLabel: '1 minute' }),
      ca('summoner', 'dismiss', 'Dismiss Eidolon', 'standard', 'no', 'Send the eidolon back to its home plane.'),
      ca('summoner', 'lifelink', 'Life Link', 'none', 'no', 'When the eidolon would be banished by damage, sacrifice your HP 1-for-1 to prevent it.'),
      ca('summoner', 'summonmonster', 'Summon Monster I', 'standard', 'no', 'Lasts 1 minute/level. Not while the eidolon is summoned.', { resource: 'summon' }),
      castSpell('summoner', 'Spontaneous arcane (cantrips, 1st level).'),
    ],
  },
  {
    className: 'Witch',
    keys: ['witch'],
    resources: [],
    actions: [
      ca('witch', 'hex', 'Hex', 'standard', 'varies', 'Your 1st-level hex (e.g. Slumber, Evil Eye; Cackle is a move action). Most hostile hexes affect a target only once per day.', { costLabel: 'Usually Standard' }),
      castSpell('witch', 'Prepared arcane (cantrips, 1st level).'),
    ],
  },
  // ---------------- Alternate
  {
    className: 'Antipaladin',
    keys: ['antipaladin'],
    resources: [res('smite', 'Smite Good', 'uses', ({ level }) => every3(level))],
    actions: [
      ca('antipaladin', 'detect', 'Detect Good', 'move', 'no', 'At will. Move action to study one target, or standard action as the spell.', { costLabel: 'Move (one target) / Standard' }),
      ca('antipaladin', 'smite', 'Smite Good', 'swift', 'no', '+Cha to attack and deflection AC, +level damage vs one good target; bypasses DR.', { resource: 'smite' }),
    ],
  },
  {
    className: 'Samurai',
    keys: ['samurai'],
    resources: [res('challenge', 'Challenge', 'uses', ({ level }) => every3(level)), res('resolve', 'Resolve', 'uses', ({ level }) => 1 + Math.floor((level - 1) / 2))],
    actions: [
      ca('samurai', 'challenge', 'Challenge', 'swift', 'no', 'As cavalier.', { resource: 'challenge' }),
      ca('samurai', 'determined', 'Resolve: Determined', 'standard', 'no', 'Remove fatigued, shaken or sickened.', { resource: 'resolve' }),
      ca('samurai', 'resolute', 'Resolve: Resolute', 'immediate', 'no', 'Before rolling a Fort or Will save: roll twice, take the better.', { resource: 'resolve' }),
      ca('samurai', 'unstoppable', 'Resolve: Unstoppable', 'immediate', 'no', 'At negative HP: stabilize automatically, stay conscious, become staggered.', { resource: 'resolve' }),
      ca('samurai', 'mount', 'Handle Mount', 'move', 'no', 'As cavalier.', { costLabel: 'Move (push)' }),
    ],
  },
  // ---------------- Hybrid
  {
    className: 'Arcanist',
    keys: ['arcanist'],
    resources: [
      res('reservoir', 'Arcane Reservoir', 'points', ({ level }) => 3 + level),
      res('consume', 'Consume Spells', 'uses', ({ mod }) => atLeast1(mod('CHA'))),
    ],
    actions: [
      ca('arcanist', 'reservoir', 'Arcane Reservoir: Boost', 'free', 'no', 'Part of casting: +1 caster level or +1 save DC. (Starts each day with 3 + ½ level points.)', { resource: 'reservoir' }),
      ca('arcanist', 'exploit', 'Arcanist Exploit', 'other', 'varies', 'Your 1st-level exploit (usually standard or swift).', { costLabel: 'Varies' }),
      ca('arcanist', 'consume', 'Consume Spells', 'move', 'no', 'Expend a 1st-level slot to gain 1 reservoir point.', { resource: 'consume' }),
      castSpell('arcanist', 'Prepared-spontaneous arcane (cantrips, 1st level).'),
    ],
  },
  {
    className: 'Bloodrager',
    keys: ['bloodrager'],
    resources: [res('bloodrage', 'Bloodrage', 'rounds', ({ level, mod }) => 4 + mod('CON') + 2 * (level - 1))],
    actions: [
      ca('bloodrager', 'rage', 'Bloodrage (1 round)', 'free', 'no', '+4 Str, +4 Con, +2 Will, −2 AC. Spend 1 round per round.', { resource: 'bloodrage' }),
      ca('bloodrager', 'bloodline', 'Bloodline Power', 'other', 'varies', 'Your 1st-level bloodline power (usually while bloodraging).', { costLabel: 'Varies' }),
    ],
  },
  {
    className: 'Brawler',
    keys: ['brawler'],
    resources: [res('flex', 'Martial Flexibility', 'uses', ({ level }) => 3 + Math.floor(level / 2))],
    actions: [ca('brawler', 'flex', 'Martial Flexibility', 'move', 'no', 'Gain one combat feat you qualify for, for 1 minute.', { resource: 'flex' })],
  },
  {
    className: 'Hunter',
    keys: ['hunter'],
    resources: [],
    actions: [
      ca('hunter', 'focus', 'Animal Focus', 'swift', 'no', 'Take an animal aspect yourself (1 minute/level per day) and/or give one to your companion (unlimited).'),
      ca('hunter', 'handle', 'Handle Animal (companion)', 'free', 'no', 'Free for a known trick; a move action to push.', { costLabel: 'Free (trick) / Move (push)' }),
      wildEmpathy('hunter'),
      castSpell('hunter', 'Spontaneous divine (orisons, 1st level).'),
    ],
  },
  {
    className: 'Investigator',
    keys: ['investigator'],
    resources: [res('inspiration', 'Inspiration', 'points', ({ level, mod }) => atLeast1(Math.floor(level / 2) + mod('INT')))],
    actions: [
      ca('investigator', 'inspire', 'Inspiration (skill/ability check)', 'free', 'no', '+1d6 to a check. Free (no point) on trained Knowledge, Linguistics, Spellcraft.', { resource: 'inspiration' }),
      ca('investigator', 'inspireattack', 'Inspiration (attack, 2 points)', 'free', 'no', '+1d6 to an attack roll. Spends 2 points.', { resource: 'inspiration', resourceCost: 2 }),
      ca('investigator', 'inspiresave', 'Inspiration (save, 2 points)', 'immediate', 'no', '+1d6 to a saving throw. Spends 2 points.', { resource: 'inspiration', resourceCost: 2 }),
      ca('investigator', 'extract', 'Drink Extract', 'standard', 'yes', 'As alchemist.'),
    ],
  },
  {
    className: 'Shaman',
    keys: ['shaman'],
    resources: [res('spirit', 'Spirit ability', 'uses', ({ mod }) => 3 + mod('CHA'))],
    actions: [
      ca('shaman', 'spirit', 'Spirit Ability', 'standard', 'varies', 'Your 1st-level spirit power (usually a standard action).', { costLabel: 'Usually Standard', resource: 'spirit' }),
      castSpell('shaman', 'Prepared divine (orisons, 1st level).'),
    ],
  },
  {
    className: 'Skald',
    keys: ['skald'],
    resources: [res('song', 'Raging Song', 'rounds', ({ level, mod }) => 3 + mod('CHA') + 2 * (level - 1))],
    actions: [
      ca('skald', 'song', 'Start Raging Song', 'standard', 'no', 'Inspired Rage: willing allies get +2 Str, +2 Con, +1 Will, −1 AC.', { resource: 'song' }),
      ca('skald', 'maintain', 'Maintain Song (1 round)', 'free', 'no', 'Keep the song going another round.', { resource: 'song' }),
      castSpell('skald', 'Spontaneous arcane (cantrips, 1st level).'),
    ],
  },
  {
    className: 'Slayer',
    keys: ['slayer'],
    resources: [],
    actions: [
      ca('slayer', 'studied', 'Studied Target', 'move', 'no', '+1 to weapon attack and damage, slayer DCs, and Bluff, Knowledge, Perception, Sense Motive and Survival vs one target.'),
    ],
  },
  {
    className: 'Swashbuckler',
    keys: ['swashbuckler'],
    resources: [res('panache', 'Panache', 'points', ({ mod }) => atLeast1(mod('CHA')))],
    actions: [
      ca('swashbuckler', 'derring', 'Derring-Do', 'free', 'no', '+1d6 (exploding on 6, up to Dex times) to Acrobatics, Climb, Escape Artist, Fly, Ride or Swim.', { resource: 'panache' }),
      ca('swashbuckler', 'dodging', 'Dodging Panache', 'immediate', 'varies', 'When targeted by a melee attack: move 5 ft (not a 5-foot step) and add Cha as dodge AC vs that attack. Light/no armor, light load.', { resource: 'panache' }),
      ca('swashbuckler', 'parry', 'Opportune Parry', 'aoo', 'no', 'Spend 1 panache and your AoO to parry a melee attack; if it works and you still have panache, riposte as an immediate action.', { resource: 'panache', roll: 'melee' }),
      ca('swashbuckler', 'riposte', 'Riposte', 'immediate', 'no', 'Counter-attack after a successful parry (needs 1 panache left).', { roll: 'melee' }),
    ],
  },
  {
    className: 'Warpriest',
    keys: ['warpriest'],
    resources: [res('blessings', 'Blessings', 'uses', ({ level }) => 3 + Math.floor(level / 2))],
    actions: [
      ca('warpriest', 'blessing', 'Blessing', 'standard', 'no', 'One of your two 1st-level blessing powers (standard or swift).', { costLabel: 'Standard or Swift', resource: 'blessings' }),
      castSpell('warpriest', 'Prepared divine (orisons, 1st level); can spontaneously cast cure or inflict.'),
    ],
  },
  // ---------------- Occult & other
  {
    className: 'Kineticist',
    keys: ['kineticist'],
    resources: [res('burn', 'Burn', 'points', ({ mod }) => 3 + mod('CON'))],
    actions: [
      ca('kineticist', 'blast', 'Kinetic Blast', 'standard', 'yes', 'Up to 30 ft: ranged attack (1d6 + 1 + Con physical) or ranged touch (1d6 + ½ Con energy). Can carry your infusion.', { roll: 'ranged' }),
      ca('kineticist', 'gather', 'Gather Power', 'move', 'no', 'Both hands free; loud and visible. Reduces a blast’s burn cost by 1 (move), 2 (full-round) or 3 (full-round + move next turn).'),
      ca('kineticist', 'acceptburn', 'Accept Burn', 'none', 'no', 'Take 1 burn (max 1/round at level 1): 1 nonlethal damage per level that can’t be healed until you rest.', { resource: 'burn' }),
      ca('kineticist', 'utility', 'Basic Utility Talent', 'standard', 'varies', 'Your basic element utility (e.g. Basic Pyrokinesis).', { costLabel: 'Usually Standard' }),
    ],
  },
  {
    className: 'Medium',
    keys: ['medium'],
    resources: [],
    actions: [
      ca('medium', 'seance', 'Channel a Spirit', 'other', 'no', 'A 1-hour séance to bind one of six legendary spirits for the day.', { costLabel: '1 hour' }),
      ca('medium', 'surge', 'Spirit Surge', 'none', 'no', 'Once per round after failing a d20 roll your spirit bonus applies to: add 1d6 and gain 1 influence.'),
      ca('medium', 'power', 'Spirit Power', 'other', 'varies', 'Lesser power of the channeled spirit.', { costLabel: 'Varies' }),
      castSpell('medium', 'Psychic knacks (Archmage/Hierophant use the mesmerist table).'),
    ],
  },
  {
    className: 'Mesmerist',
    keys: ['mesmerist'],
    resources: [res('tricks', 'Mesmerist Tricks', 'uses', ({ level, mod }) => atLeast1(Math.floor(level / 2)) + mod('CHA'))],
    actions: [
      ca('mesmerist', 'stare', 'Hypnotic Stare', 'swift', 'no', 'One target within 30 ft takes −2 on Will saves.'),
      ca('mesmerist', 'painful', 'Painful Stare', 'free', 'no', 'Once per round (even off-turn) when your stared target takes damage: +1 precision damage.'),
      ca('mesmerist', 'trick', 'Implant Mesmerist Trick', 'standard', 'no', 'Implant a trick in an ally; triggering it later is free.', { resource: 'tricks' }),
      castSpell('mesmerist', 'Spontaneous psychic (knacks, 1st level).'),
    ],
  },
  {
    className: 'Occultist',
    keys: ['occultist'],
    resources: [res('focus', 'Mental Focus', 'points', ({ level, mod }) => level + mod('INT'))],
    actions: [
      ca('occultist', 'focus', 'Focus Power', 'standard', 'varies', 'One of your focus powers (usually standard or swift).', { costLabel: 'Standard or Swift', resource: 'focus' }),
      castSpell('occultist', 'Spontaneous psychic (knacks, 1st level).'),
    ],
  },
  {
    className: 'Psychic',
    keys: ['psychic'],
    resources: [res('phrenic', 'Phrenic Pool', 'points', ({ level, mod }) => Math.max(0, Math.floor(level / 2) + Math.max(mod('WIS'), mod('CHA'))))],
    actions: [
      ca('psychic', 'amplify', 'Phrenic Amplification', 'free', 'no', 'Part of casting: spend phrenic points to modify a linked spell.', { resource: 'phrenic' }),
      ca('psychic', 'discipline', 'Discipline Power', 'other', 'varies', 'Your 1st-level discipline power.', { costLabel: 'Varies' }),
      castSpell('psychic', 'Spontaneous psychic (knacks, 1st level).'),
    ],
  },
  {
    className: 'Spiritualist',
    keys: ['spiritualist'],
    resources: [res('shunt', 'Shared Consciousness', 'uses', () => 1)],
    actions: [
      ca('spiritualist', 'manifest', 'Manifest Phantom', 'other', 'no', 'A 1-minute ritual: ectoplasmic or incorporeal form.', { costLabel: '1 minute' }),
      ca('spiritualist', 'harbor', 'Harbor / Dismiss Phantom', 'standard', 'no', 'Return the phantom to your consciousness.'),
      ca('spiritualist', 'shunt', 'Shunt Mind-Affecting Effect', 'immediate', 'no', 'While harbored: shunt a failed save vs a mind-affecting effect into the phantom.', { resource: 'shunt' }),
      ca('spiritualist', 'tether', 'Etheric Tether', 'fullRound', 'yes', 'Keep an ectoplasmic phantom manifested at 50–100 ft. Also: sacrifice HP 1-for-1 to stop it being banished (no action).'),
      castSpell('spiritualist', 'Spontaneous psychic (knacks, 1st level).'),
    ],
  },
  {
    className: 'Shifter',
    keys: ['shifter'],
    resources: [res('aspect', 'Shifter Aspect', 'minutes', ({ level }) => 3 + level)],
    actions: [
      ca('shifter', 'claws', 'Shifter’s Claws', 'swift', 'no', 'Extend claws: 2 primary attacks (1d4, 1d3 if Small). Retracting is free.'),
      ca('shifter', 'aspect', 'Shifter Aspect (1 minute)', 'swift', 'no', 'Take your minor aspect. Ending it is free.', { resource: 'aspect' }),
      wildEmpathy('shifter'),
    ],
  },
  {
    className: 'Vigilante',
    keys: ['vigilante'],
    resources: [],
    actions: [
      ca('vigilante', 'identity', 'Switch Identity', 'other', 'no', 'Change between social and vigilante identities (out of sight). Takes 1 minute.', { costLabel: '1 minute' }),
      ca('vigilante', 'talent', 'Social Talent', 'other', 'varies', 'Your 1st-level social talent.', { costLabel: 'Varies' }),
    ],
  },
];

/** Class action sets that apply to a list of class names (with each class's level). */
export function classActionSetsFor(classes: { name: string; level: number }[]): { set: ClassActionSet; level: number }[] {
  const out: { set: ClassActionSet; level: number }[] = [];
  for (const k of classes) {
    const key = normalizeName(k.name);
    const set = CLASS_ACTIONS.find((s) => s.keys.includes(key));
    if (set && !out.some((o) => o.set === set)) out.push({ set, level: k.level });
  }
  return out;
}

const ALL_ACTIONS = new Map<string, Pf1Action>([...GENERIC_ACTIONS, ...CLASS_ACTIONS.flatMap((s) => s.actions)].map((a) => [a.id, a]));

export function lookupPf1Action(id: string): Pf1Action | undefined {
  return ALL_ACTIONS.get(id);
}

/** The class action set an action belongs to, if any. */
export function classSetForAction(id: string): ClassActionSet | undefined {
  return CLASS_ACTIONS.find((s) => s.actions.some((a) => a.id === id));
}
