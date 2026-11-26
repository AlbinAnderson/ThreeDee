/**
 * Combat options a character switches on and off (Power Attack, Deadly Aim,
 * Combat Expertise, Fight defensively...). Active toggles live in
 * `runtime.toggles`; the stat engine applies them to attacks and AC.
 */
import type { Character } from '../entities/pf1e';
import { featKey } from './rules';

export type ToggleId = 'powerAttack' | 'piranhaStrike' | 'deadlyAim' | 'combatExpertise' | 'fightDefensively' | 'totalDefense' | 'rapidShot';

export interface ToggleDef {
  id: ToggleId;
  label: string;
  /** Feat key needed (featKey form); null = anyone can. */
  feat: string | null;
  /** Can't be on together with these. */
  excludes: ToggleId[];
  /** Short rules summary; `step` is 1 + BAB/4 where it matters. */
  describe: (step: number, acrobaticsRanks: number) => string;
}

export const TOGGLES: ToggleDef[] = [
  {
    id: 'powerAttack',
    label: 'Power Attack',
    feat: 'powerattack',
    excludes: ['piranhaStrike'],
    describe: (n) => `Melee: −${n} attack, +${2 * n} damage (+${3 * n} two-handed, +${n} off hand)`,
  },
  {
    id: 'piranhaStrike',
    label: 'Piranha Strike',
    feat: 'piranhastrike',
    excludes: ['powerAttack'],
    describe: (n) => `Light or finesse melee weapons: −${n} attack, +${2 * n} damage (+${n} off hand)`,
  },
  {
    id: 'deadlyAim',
    label: 'Deadly Aim',
    feat: 'deadlyaim',
    excludes: [],
    describe: (n) => `Ranged: −${n} attack, +${2 * n} damage`,
  },
  {
    id: 'combatExpertise',
    label: 'Combat Expertise',
    feat: 'combatexpertise',
    excludes: [],
    describe: (n) => `Melee: −${n} attack, +${n} dodge AC`,
  },
  {
    id: 'fightDefensively',
    label: 'Fight defensively',
    feat: null,
    excludes: ['totalDefense'],
    describe: (_n, ranks) => `−4 attack, +${ranks >= 3 ? 3 : 2} dodge AC`,
  },
  {
    id: 'totalDefense',
    label: 'Total defense',
    feat: null,
    excludes: ['fightDefensively'],
    describe: (_n, ranks) => `No attacks this round, +${ranks >= 3 ? 6 : 4} dodge AC`,
  },
  {
    id: 'rapidShot',
    label: 'Rapid Shot',
    feat: 'rapidshot',
    excludes: [],
    describe: () => 'Ranged full attack: one extra attack, all at −2',
  },
];

/** 1 + 1 per 4 BAB: the scaling step of Power Attack, Deadly Aim, Combat Expertise. */
export const toggleStep = (bab: number) => 1 + Math.floor(Math.max(0, bab) / 4);

function featKeys(c: Character): Set<string> {
  return new Set([...c.build.abilities.map((a) => a.key), ...c.build.legacyFeats, ...c.build.virtualFeats].map(featKey));
}

/** Ranks in Acrobatics (sheet override or file): 3+ improves fighting defensively and total defense. */
export function acrobaticsRanks(c: Character): number {
  const override = c.sheet.skills.Acrobatics?.ranks;
  if (override !== null && override !== undefined) return override;
  return Math.floor(c.build.skills.find((s) => s.name.trim().toLowerCase() === 'acrobatics')?.totalRanks ?? 0);
}

/** Toggles this character can use (has the feat, or anyone can). */
export function availableToggles(c: Character): ToggleDef[] {
  const keys = featKeys(c);
  return TOGGLES.filter((t) => t.feat === null || keys.has(t.feat));
}

/** Active toggles, ignoring any the character can no longer use (feat retrained away). */
export function activeToggles(c: Character): Set<ToggleId> {
  const allowed = new Set(availableToggles(c).map((t) => t.id));
  return new Set(Object.entries(c.runtime.toggles ?? {}).flatMap(([id, on]) => (on && allowed.has(id as ToggleId) ? [id as ToggleId] : [])));
}

/** New toggles map after switching one on/off (switching on turns off whatever it excludes). */
export function setToggle(current: Record<string, boolean>, id: ToggleId, on: boolean): Record<string, boolean> {
  const next = { ...current };
  if (on) {
    next[id] = true;
    for (const x of TOGGLES.find((t) => t.id === id)?.excludes ?? []) delete next[x];
  } else delete next[id];
  return next;
}
