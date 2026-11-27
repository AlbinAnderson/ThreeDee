/**
 * Monster stat blocks (parsed from Archives of Nethys) as GM-only NPC
 * characters and hidden map tokens (Epic 11).
 *
 * The stat engine derives numbers from a build; a stat block already has the
 * final numbers. So the monster gets a racial-HD "class" with the right BAB
 * progression and hit die, its ability scores, feats and stat-block attacks,
 * and then sheet misc modifiers that make HP, AC, saves, initiative, CMB, CMD
 * and skills land exactly on the stat block (buffs and conditions still apply
 * on top, so the sheet and Actions panel keep working).
 */
import { EMPTY_BIO, EMPTY_RUNTIME, EMPTY_SHEET, type Character, type CharacterSheet, type StatAttack } from '../entities/pf1e';
import { emptyPcgenBuild } from '../pcgen/parsePcg';
import { computeCharacterStats } from '../pf1e/engine';
import { computeSkills, skillDef } from '../pf1e/skills';
import { SIZE_CELLS, STAT_KEYS } from '../pf1e/rules';
import { createToken, type Token } from '../state';
import type { MonsterDraft } from './aonParse';

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(n)));

/** BAB progression that gives this BAB at this many hit dice. */
function babProgression(bab: number, hd: number): 'full' | 'threeQuarter' | 'half' {
  if (bab >= hd) return 'full';
  if (bab >= Math.floor((hd * 3) / 4)) return 'threeQuarter';
  return 'half';
}

function summary(m: MonsterDraft): string {
  const lines = [
    `${m.name}${m.cr ? ` (CR ${m.cr}${m.xp ? `, ${m.xp.toLocaleString('en-US')} XP` : ''})` : ''}`,
    [m.alignment, m.size, m.type].filter(Boolean).join(' '),
    m.senses.text && `Senses: ${m.senses.text}`,
    `AC ${m.ac.total}, touch ${m.ac.touch}, flat-footed ${m.ac.flatFooted}${m.ac.breakdown ? ` (${m.ac.breakdown})` : ''}`,
    `hp ${m.hp.total}${m.hp.hd ? ` (${m.hp.hd})` : ''}`,
    m.defensive && `Defensive abilities: ${m.defensive}`,
    m.dr && `DR ${m.dr}`,
    m.immune && `Immune ${m.immune}`,
    m.resist && `Resist ${m.resist}`,
    m.sr !== null && `SR ${m.sr}`,
    m.weaknesses && `Weaknesses: ${m.weaknesses}`,
    m.speed.text && `Speed ${m.speed.text}`,
    `Space ${m.space} ft.; Reach ${m.reach} ft.`,
    m.specialAttacks && `Special attacks: ${m.specialAttacks}`,
    m.sq && `SQ: ${m.sq}`,
    m.languages && `Languages: ${m.languages}`,
    m.source && `Source: ${m.source}`,
    m.url && `Archives of Nethys: ${m.url}`,
  ];
  return lines.filter(Boolean).join('\n').slice(0, 10000);
}

export function statAttacksFor(m: MonsterDraft): StatAttack[] {
  return [...m.melee, ...m.ranged].slice(0, 20).map((a, i) => ({ ...a, id: `atk${i + 1}` }));
}

/**
 * A GM-only NPC (no owner, unshared) from a parsed stat block. Totals on the
 * sheet match the stat block; touch and flat-footed AC follow the engine's
 * Dex / dodge handling of that total.
 */
export function monsterToCharacter(m: MonsterDraft, opts: { id: string; now: number; importedBy: string }): Character {
  const build = emptyPcgenBuild();
  build.bio.name = m.name.slice(0, 80);
  build.attributes.alignment = m.alignment || null;
  for (const k of STAT_KEYS) build.attributes.stats[k] = m.abilities[k] ?? 10;
  const className = `${(m.type.split(/[\s(]/)[0] || 'Monster').replace(/^\w/, (c) => c.toUpperCase())} (racial HD)`.slice(0, 80);
  build.classes = [{ name: className, level: m.hp.hitDice, subClass: null, skillPool: null, spellBase: null, canCastPerDay: null, specialty: null, prohibited: [], extra: [] }];
  build.legacyFeats = m.feats.slice(0, 60);
  build.skills = m.skills
    .filter((s) => skillDef(s.name))
    .map((s) => ({ name: s.name, outputOrder: null, totalRanks: 0, classBought: [], synergy: null, associatedData: [], extra: [] }));

  const sheet: CharacterSheet = {
    ...structuredClone(EMPTY_SHEET),
    classChassis: { [className]: { hd: m.hp.die, bab: babProgression(m.bab, m.hp.hitDice), goodSaves: [], prestige: false } },
    size: m.size,
    speed: clamp(m.speed.base, 0, 300),
    darkvision: clamp(m.senses.darkvision, 0, 600),
    statAttacks: statAttacksFor(m),
    misc: {},
  };
  if (m.ac.natural) sheet.misc.natural = clamp(m.ac.natural, -100, 1000);
  if (m.ac.deflection) sheet.misc.deflection = clamp(m.ac.deflection, -100, 1000);

  const character: Character = {
    id: opts.id,
    name: m.name.slice(0, 80) || 'Monster',
    ownerId: null,
    tokenId: null,
    shared: false,
    source: { kind: 'pcgen', fileName: `Archives of Nethys: ${m.name}`.slice(0, 255), importedAt: opts.now, importedBy: opts.importedBy },
    build,
    sheet,
    runtime: { ...structuredClone(EMPTY_RUNTIME), hp: { current: clamp(m.hp.total, -100000, 100000), temp: 0, nonlethal: 0 } },
    inventory: { items: [], coins: { pp: 0, gp: 0, sp: 0, cp: 0 }, loadouts: [{ id: 'l1', name: 'Default', slots: {} }], activeLoadoutId: 'l1' },
    companion: null,
    bio: {
      ...structuredClone(EMPTY_BIO),
      description: summary(m),
      notes: m.specialAbilities ? [{ id: 'n1', parentId: null, title: 'Special abilities', body: m.specialAbilities.slice(0, 8000) }] : [],
    },
    createdAt: opts.now,
    updatedAt: opts.now,
  };

  // Land the engine's totals on the stat block with sheet misc modifiers.
  const stats = computeCharacterStats(character);
  const delta = (target: number, current: number) => clamp(target - current, -100, 1000);
  const misc = sheet.misc;
  const set = (k: keyof typeof misc, v: number) => {
    if (v) misc[k] = clamp((misc[k] ?? 0) + v, -100, 1000);
  };
  set('hp', delta(m.hp.total, stats.hp.total));
  set('initiative', delta(m.init, stats.initiative.total));
  set('fort', delta(m.saves.fort, stats.saves.fort.total));
  set('ref', delta(m.saves.ref, stats.saves.ref.total));
  set('will', delta(m.saves.will, stats.saves.will.total));
  set('ac', delta(m.ac.total, stats.ac.normal.total));
  set('cmb', delta(m.cmb, stats.cmb.total));
  set('cmd', delta(m.cmd, stats.cmd.total));

  const skillRows = computeSkills(character, computeCharacterStats(character)).rows;
  for (const s of m.skills) {
    const row = skillRows.find((r) => r.name.toLowerCase() === s.name.toLowerCase());
    const custom = !skillDef(s.name);
    const current = row?.total.total ?? 0;
    sheet.skills[s.name.slice(0, 80)] = { ranks: null, misc: clamp(s.bonus - current, -50, 50), classSkill: null, favorite: false, custom };
  }
  return character;
}

/** A hidden map token for the monster, clamped to the token schema (size from Space, darkvision in cells). */
export function monsterToken(m: MonsterDraft, opts: { id: string; sceneId: string; x: number; y: number; unitsPerCell: number }): Token {
  const units = opts.unitsPerCell > 0 ? opts.unitsPerCell : 5;
  const fromSpace = m.space > 0 ? m.space / units : SIZE_CELLS[m.size];
  const hp = clamp(m.hp.total, 1, 100000);
  return createToken({
    id: opts.id,
    sceneId: opts.sceneId,
    x: clamp(opts.x, -100000, 100000),
    y: clamp(opts.y, -100000, 100000),
    name: m.name.slice(0, 60),
    color: '#8b2d2d',
    size: Math.max(0.25, Math.min(20, Math.round(fromSpace * 4) / 4)),
    hidden: true,
    showName: true,
    hp: { value: hp, max: hp, temp: 0 },
    hpVisible: false,
    darkvision: Math.max(0, Math.min(200, Math.round(m.senses.darkvision / units))),
  });
}
