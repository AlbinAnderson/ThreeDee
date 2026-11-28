import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import {
  actionCostFor,
  buildCharacterRulesData,
  canSpend,
  characterActions,
  characterResources,
  characterSpellcasting,
  checkPrepared,
  computeCharacterStats,
  computeSkills,
  createCharacterFromPcg,
  createInitialState,
  createToken,
  detectGear,
  effectiveConditions,
  effectiveTurn,
  freshTurn,
  inventoryActions,
  lookupArmor,
  lookupPf1Action,
  lookupPreset,
  lookupSpell,
  makeItem,
  newId,
  parsePcg,
  pf1eTurnActions,
  planCast,
  presetBuff,
  resolveClassName,
  sellValueCp,
  situationalFor,
  sizedDamage,
  spellCard,
  sumModifiers,
  weaponFromRecord,
  type Character,
  type EquipmentRecord,
  type FeatRecord,
  type RulesProvider,
  type User,
} from '@vtt/shared';
import { parseStaticBonuses } from '../../src/rules/buildPack';
import { createRulesPackStore } from '../../src/rules/packStore';
import { SqliteRoomStore } from '../../src/persistence/SqliteRoomStore';
import { Room, type Client } from '../../src/rooms/Room';

function pcgChar(opts: {
  race?: string;
  classes?: string[];
  classLevels?: string[];
  stats?: Partial<Record<'STR' | 'DEX' | 'CON' | 'INT' | 'WIS' | 'CHA', number>>;
  extra?: string[];
}): Character {
  const s = { STR: 10, DEX: 10, CON: 10, INT: 10, WIS: 10, CHA: 10, ...opts.stats };
  const lines = [
    'PCGVERSION:2.0',
    'CHARACTERNAME:Audit Hero',
    `RACE:${opts.race ?? 'Human'}`,
    ...(['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'] as const).map((k) => `STAT:${k}|SCORE:${s[k]}`),
    ...(opts.classes ?? ['CLASS:Fighter|LEVEL:1|SKILLPOOL:0']),
    ...(opts.classLevels ?? ['CLASSABILITIESLEVEL:Fighter=1|HITPOINTS:10']),
    ...(opts.extra ?? []),
  ];
  return createCharacterFromPcg(parsePcg(lines.join('\n')), { id: 'c1', ownerId: 'u1', fileName: 'a.pcg', importedBy: 'u1', now: 1 });
}

describe('PF1e rules audit round 2 regressions', () => {
  test('racial bonuses stack in sumModifiers; Halfling Luck adds +1 racial to all saves', () => {
    const stacked = sumModifiers([
      { value: 2, type: 'racial', source: 'Race A' },
      { value: 2, type: 'racial', source: 'Race B' },
    ]);
    assert.equal(stacked.total, 4);

    const halfling = pcgChar({ race: 'Halfling', stats: { CON: 10, DEX: 10, WIS: 10 } });
    const stats = computeCharacterStats(halfling);
    // Fighter 1: Fort +2 base +1 racial = 3; Ref +0 base +1 Dex (+2 racial Dex) +1 racial = 2; Will +0 base +1 racial = 1
    assert.equal(stats.saves.fort.total, 3);
    assert.equal(stats.saves.ref.total, 2);
    assert.equal(stats.saves.will.total, 1);
  });

  test('ability penalty floor (min 1), drain floor (min 0), Con damage separate from min-1-HP clamp, and permanentMod ignores damage', () => {
    const c = pcgChar({
      classes: ['CLASS:Wizard|LEVEL:4|SKILLPOOL:0'],
      classLevels: [
        'CLASSABILITIESLEVEL:Wizard=1|HITPOINTS:6',
        'CLASSABILITIESLEVEL:Wizard=2|HITPOINTS:1',
        'CLASSABILITIESLEVEL:Wizard=3|HITPOINTS:1',
        'CLASSABILITIESLEVEL:Wizard=4|HITPOINTS:1',
      ],
      stats: { STR: 4, CON: 10, INT: 16 },
    });
    c.runtime.conditions = ['Exhausted']; // -6 Str/Dex penalty
    c.runtime.abilityDamage = { CON: 4, INT: 4 }; // -2 mod penalty, must NOT change permanentScore/permanentMod
    const stats = computeCharacterStats(c);
    assert.equal(stats.abilities.STR.score, 1, 'ability penalties cannot drop score below 1');
    assert.equal(stats.abilities.STR.mod, -5);
    assert.equal(stats.abilities.INT.permanentScore, 16);
    assert.equal(stats.abilities.INT.permanentMod, 3, 'ability damage does not lower permanentMod');
    assert.equal(stats.abilities.INT.mod, 1, 'ability damage lowers live mod for DCs/Concentration');
    // HP: rolled 9 + 0 Con score mod - (floor(4/2) * 4 HD = 8) = 1 HP (not blocked by per-HD min-1 floor!)
    assert.equal(stats.hp.total, 1);

    // Bonus spells & min casting score use permanentScore/permanentMod (CRB p.555)
    c.runtime.abilityTemp = { INT: 4 }; // Fox's Cunning-like temp bonus should NOT grant extra slots
    const wizInfo = characterSpellcasting(c)[0]!;
    assert.equal(wizInfo.levels.find((l) => l.level === 2)?.bonus, 1, 'INT 16 permanent gives +1 2nd-level bonus spell even with temp +4 and 4 INT damage');
    assert.equal(wizInfo.levels.find((l) => l.level === 1)?.bonus, 1, 'temp +4 INT does not grant a 2nd 1st-level bonus spell');
  });

  test('Monk / Unchained Monk AC bonus, PCGen Unchained class marker, and Uncanny Dodge', () => {
    const uMonk = pcgChar({
      classes: ['CLASS:Monk|LEVEL:4|SKILLPOOL:0'],
      classLevels: [
        'CLASSABILITIESLEVEL:Monk=1|HITPOINTS:10',
        'CLASSABILITIESLEVEL:Monk=2|HITPOINTS:6',
        'CLASSABILITIESLEVEL:Monk=3|HITPOINTS:6',
        'CLASSABILITIESLEVEL:Monk=4|HITPOINTS:6',
      ],
      stats: { DEX: 14, WIS: 16 },
      extra: ['ABILITY:Special Ability|TYPE:NORMAL|CATEGORY:Special Ability|KEY:Monk ~ Unchained Class'],
    });
    assert.equal(resolveClassName(uMonk, 'Monk'), 'Monk (Unchained)');
    const ms = computeCharacterStats(uMonk);
    assert.equal(ms.bab.total, 4, 'Unchained Monk has full BAB');
    assert.equal(ms.saves.will.total, 1 + 3, 'Unchained Monk has poor Will (1 base + 3 Wis)');
    // AC: 10 + 2 Dex + 3 Wis + 1 (lvl 4/4) = 16 normal, 16 touch, 14 flat-footed (keeps Monk AC bonus!)
    assert.equal(ms.ac.normal.total, 16);
    assert.equal(ms.ac.touch.total, 16);
    assert.equal(ms.ac.flatFooted.total, 14);
    assert.equal(ms.cmd.total, 10 + 4 + 0 + 2 + 4, 'CMD includes Monk AC bonus');

    // Uncanny Dodge retains Dex + Dodge in flat-footed AC & ignores flat-footed condition
    const barb = pcgChar({
      classes: ['CLASS:Barbarian|LEVEL:2|SKILLPOOL:0'],
      stats: { DEX: 16 },
      extra: ['FEAT:Dodge', 'ABILITY:Special Ability|TYPE:NORMAL|CATEGORY:Special Ability|KEY:Barbarian ~ Unchained Class'],
    });
    barb.runtime.conditions = ['Flat-footed'];
    const bs = computeCharacterStats(barb);
    assert.equal(bs.ac.normal.total, 10 + 3 + 1, 'Uncanny Dodge ignores Flat-footed condition');
    assert.equal(bs.ac.flatFooted.total, 10 + 3 + 1, 'Uncanny Dodge retains Dex + Dodge while flat-footed');
    assert.equal(bs.effects.loseDexToAc, false);
    // Haste +1 dodge to Reflex drops when actually denied Dex (e.g. Blinded)
    barb.runtime.conditions = ['Blinded'];
    barb.runtime.buffs = [presetBuff(barb, lookupPreset('haste')!, undefined, { mod: () => 0 }, 'b1')];
    const blinded = computeCharacterStats(barb);
    assert.equal(blinded.effects.loseDexToAc, true);
    assert.equal(blinded.saves.ref.parts.some((p) => p.type === 'dodge'), false, 'Haste dodge Reflex bonus dropped when losing Dex');
  });

  test('Tower Shield -2 attack/CMB, Buckler -1 off-hand, Improved Critical, ITWF/GTWF without BAB gate, Quick Draw thrown, Deadly Aim splash, Alchemical Silver, and statAttack toggles', () => {
    const c = pcgChar({
      classes: ['CLASS:Fighter|LEVEL:6|SKILLPOOL:0'],
      stats: { STR: 14, DEX: 14 },
      extra: [
        'ABILITY:FEAT|TYPE:NORMAL|CATEGORY:FEAT|KEY:Improved Critical|APPLIEDTO:Longsword',
        'FEAT:Quick Draw',
        'FEAT:Two-Weapon Fighting',
        'FEAT:Improved Two-Weapon Fighting',
        'FEAT:Greater Two-Weapon Fighting',
        'FEAT:Deadly Aim',
        'FEAT:Power Attack',
      ],
    });
    c.inventory.items = [
      makeItem({ id: 'sw', name: 'Alchemical Silver Longsword', ...detectGear('Alchemical Silver Longsword') }),
      makeItem({ id: 'dag', name: 'Dagger', ...detectGear('Dagger') }),
      makeItem({ id: 'acid', name: 'Acid flask', ...detectGear('Acid flask') }),
      makeItem({ id: 'ts', name: 'Tower shield', ...detectGear('Tower shield') }),
    ];
    c.inventory.loadouts[0]!.slots = { sw: 'primary', dag: 'offHand', ts: 'shield' };
    const stats = computeCharacterStats(c);
    const sw = stats.attacks.find((a) => a.itemId === 'sw')!;
    assert.equal(sw.crit, '17-20/×2', 'Improved Critical doubles 19-20 to 17-20');
    assert.ok(sw.attack.parts.some((p) => p.source === 'Tower shield' && p.value === -2));
    assert.ok(stats.cmb.parts.some((p) => p.source === 'Tower shield' && p.value === -2));
    assert.ok(sw.damage.parts.some((p) => p.source === 'Alchemical silver' && p.value === -1));
    assert.equal(stats.twoWeapon?.offHand.length, 3, 'GTWF grants 3rd off-hand attack regardless of BAB gate');
    const dagThrown = stats.attacks.find((a) => a.itemId === 'dag' && a.mode === 'thrown')!;
    assert.equal(dagThrown.fullAttack.length, 2, 'Quick Draw allows thrown iterative attacks at BAB +6');

    // Buckler -1 on off-hand
    c.inventory.items.push(makeItem({ id: 'bk', name: 'Buckler', ...detectGear('Buckler') }));
    c.inventory.loadouts[0]!.slots = { sw: 'primary', dag: 'offHand', bk: 'shield' };
    const withBuckler = computeCharacterStats(c);
    assert.ok(withBuckler.attacks.find((a) => a.itemId === 'dag' && a.mode === 'melee')!.attack.parts.some((p) => p.source === 'Buckler' && p.value === -1));

    // Deadly Aim splash weapon: penalty applies, bonus damage does NOT
    c.inventory.loadouts[0]!.slots = { acid: 'primary' };
    c.runtime.toggles = { deadlyAim: true };
    const splash = computeCharacterStats(c).attacks.find((a) => a.itemId === 'acid')!;
    assert.ok(splash.attack.parts.some((p) => p.source === 'Deadly Aim' && p.value === -2));
    assert.ok(!splash.damage.parts.some((p) => p.source === 'Deadly Aim'), 'no Deadly Aim damage on splash weapon');

    // Stat-block attacks honor Power Attack
    c.sheet.statAttacks = [{ id: 'sa1', name: 'Bite', mode: 'melee', bonuses: [10], dice: '1d8', damageBonus: 4, critRange: 20, critMult: 2, note: '' }];
    c.runtime.toggles = { powerAttack: true };
    const sa = computeCharacterStats(c).attacks.find((a) => a.itemId === 'stat:sa1')!;
    assert.equal(sa.attack.total, 8, 'Power Attack -2 applies to statAttack');
    assert.equal(sa.damage.total, 8, 'Power Attack +4 applies to statAttack');
  });

  test('buffs & conditions: bestCasterLevel non-stacking, fear/sickened initiative, dying->helpless, speed half/zero, Arcane Pool non-stack with Masterwork', () => {
    const multi = pcgChar({
      classes: ['CLASS:Cleric|LEVEL:3|SKILLPOOL:0', 'CLASS:Wizard|LEVEL:3|SKILLPOOL:0'],
    });
    const df = presetBuff(multi, lookupPreset('divineFavor')!, undefined, { mod: () => 0 }, 'df');
    assert.equal(df.effects.find((x) => x.target === 'attack')?.value, 1, 'Cleric 3 / Wizard 3 has max CL 3 (+1 Divine Favor), not CL 6 (+2)');

    assert.ok(effectiveConditions(['Dying']).includes('helpless'), 'Dying transitively implies unconscious -> helpless');

    const c = pcgChar({ classes: ['CLASS:Magus|LEVEL:1|SKILLPOOL:0'], stats: { DEX: 14 } });
    c.runtime.conditions = ['Shaken', 'Entangled'];
    const s = computeCharacterStats(c);
    assert.ok(s.initiative.parts.some((p) => p.source === 'Shaken' && p.value === -2), 'Shaken penalizes Initiative');
    assert.equal(s.speed.total, 15, 'Entangled halves 30 ft speed to 15 ft');

    c.runtime.conditions = ['Paralyzed'];
    assert.equal(computeCharacterStats(c).speed.total, 0, 'Paralyzed sets speed to 0 ft');

    c.runtime.conditions = [];
    c.inventory.items = [makeItem({ id: 'mwk', name: 'Masterwork Longsword', ...detectGear('Masterwork Longsword') })];
    c.inventory.loadouts[0]!.slots = { mwk: 'primary' };
    c.runtime.buffs = [presetBuff(c, lookupPreset('arcanePool')!, undefined, { mod: () => 0 }, 'ap')];
    const apStats = computeCharacterStats(c);
    const atk = apStats.attacks[0]!;
    assert.ok(!atk.attack.parts.some((p) => p.source === 'Masterwork'), 'Arcane Pool does not stack with Masterwork +1');
    assert.equal(atk.attack.total, 1, 'BAB 0 + Str 0 + Arcane Pool +1 = +1 (not +2)');
  });

  test('economy & class resources: condition locks, off-turn free actions, Total Defense AoO block, permanentMod pools, Arcanist reservoir reset, action upgrades', () => {
    const state = createInitialState('sc1');
    const c = pcgChar({
      classes: ['CLASS:Arcanist|LEVEL:10|SKILLPOOL:0'],
      stats: { INT: 16, CHA: 14 },
    });
    const tok = createToken({ id: 't1', sceneId: 'sc1', x: 0, y: 0, ownerIds: ['u1'] });
    c.tokenId = 't1';
    state.tokens.t1 = tok;
    state.characters[c.id] = c;
    state.combat.active = true;
    state.combat.round = 1;
    state.combat.currentId = 'cb1';
    state.combat.combatants = [
      { id: 'cb1', name: 'Hero', tokenId: 't1', initiative: 15, modifier: 0, hidden: false },
      { id: 'cb2', name: 'Foe', tokenId: null, initiative: 10, modifier: 0, hidden: false },
    ];

    // Staggered blocks full-round and second action
    tok.conditions = ['Staggered'];
    let et = effectiveTurn(state, 'cb1');
    assert.notEqual(canSpend(et, 'fullRound'), true);
    assert.equal(canSpend(et, 'standard'), true);
    assert.notEqual(canSpend({ ...et, turn: { ...freshTurn(1), standard: true } }, 'move'), true);

    // Stunned blocks all actions
    tok.conditions = ['Stunned'];
    et = effectiveTurn(state, 'cb1');
    assert.notEqual(canSpend(et, 'standard'), true);
    assert.notEqual(canSpend(et, 'aoo'), true);

    // Free action blocked off-turn unless offTurn=true
    tok.conditions = [];
    state.combat.currentId = 'cb2';
    et = effectiveTurn(state, 'cb1');
    assert.notEqual(canSpend(et, 'free'), true);
    assert.equal(canSpend(et, 'free', false, true), true);

    // Total Defense blocks AoO
    c.runtime.toggles = { totalDefense: true };
    et = effectiveTurn(state, 'cb1');
    assert.notEqual(canSpend(et, 'aoo'), true);

    // Action upgrades & (Sp) provokes
    assert.equal(actionCostFor(lookupPf1Action('c.brawler.flex')!, 6), 'swift');
    assert.equal(actionCostFor(lookupPf1Action('c.brawler.flex')!, 10), 'free');
    assert.equal(actionCostFor(lookupPf1Action('c.slayer.studied')!, 7), 'swift');
    assert.equal(actionCostFor(lookupPf1Action('c.cavalier.tactician')!, 9), 'swift');
    assert.equal(lookupPf1Action('c.paladin.detect')?.provokes, 'yes');
    assert.equal(lookupPf1Action('c.cavalier.mount')?.cost, 'free');

    // Temporary ability buff does not inflate Alchemist Bombs
    const alch = pcgChar({ classes: ['CLASS:Alchemist|LEVEL:3|SKILLPOOL:0'], stats: { INT: 16 } });
    alch.runtime.abilityTemp = { INT: 4 };
    assert.equal(characterResources(alch).find((r) => r.def.id === 'bombs')?.max, 6, '3 lvl + 3 perm INT = 6 bombs (not 8)');

    // Arcanist Arcane Reservoir starts at 3 + floor(10/2) = 8 out of max 13 after rest
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vtt-r2-'));
    try {
      const store = new SqliteRoomStore(path.join(dir, 'vtt.db'));
      const room = new Room('main', createInitialState('sc1'), store, { autoIntervalMs: 1e12, keepAllForMs: 1e12, keepDailyForMs: 1e12 });
      const gm: Client = { id: newId(), user: null, room: null, seq: 0, send: () => {} };
      const gmUser: User = { id: 'gm', name: 'GM', role: 'gm', color: '#ffffff' };
      room.join(gm, gmUser);
      const cArc = pcgChar({ classes: ['CLASS:Arcanist|LEVEL:10|SKILLPOOL:0'], stats: { INT: 16, CHA: 14 } });
      cArc.ownerId = 'gm';
      room.handleClientAction(gm, newId(), characterActions.import.create({ character: cArc }));
      room.handleClientAction(gm, newId(), pf1eTurnActions.resetUses.create({ characterId: cArc.id }));
      const after = room.currentState.characters[cArc.id]!;
      assert.equal(after.runtime.uses['arcanist.reservoir'], 5, '13 max - 8 start = 5 used after rest');
      store.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('spells, skills, gear special materials, weapon sizing, pricing, and Catalog add-free', () => {
    // Medium & Adept in CASTERS
    const med = pcgChar({ classes: ['CLASS:Medium|LEVEL:4|SKILLPOOL:0'], stats: { CHA: 14 } });
    const medInfo = characterSpellcasting(med)[0]!;
    assert.equal(medInfo.tradition, 'psychic');
    assert.equal(medInfo.levels.find((l) => l.level === 1)?.perDay, 2, '1 base + 1 bonus');

    const adept = pcgChar({ classes: ['CLASS:Adept|LEVEL:5|SKILLPOOL:0'], stats: { WIS: 14 } });
    const adeptInfo = characterSpellcasting(adept)[0]!;
    assert.equal(adeptInfo.tradition, 'divine');
    assert.equal(adeptInfo.levels.find((l) => l.level === 2)?.perDay, 2);

    // SPELLLIST merged into known, Uncanny Concentration +2, Combat Casting +4 roll, Widen Spell excludes line/square
    const wiz = pcgChar({
      classes: ['CLASS:Wizard|LEVEL:11|SKILLPOOL:0'],
      stats: { INT: 16 },
      extra: [
        'SPELLLIST:CLASS:Wizard|LEVEL:3|SPELL:Lightning Bolt',
        'FEAT:Uncanny Concentration',
        'FEAT:Combat Casting',
        'ABILITY:FEAT|TYPE:NORMAL|CATEGORY:FEAT|KEY:Widen Spell|TYPE:Metamagic',
      ],
    });
    const wi = characterSpellcasting(wiz)[0]!;
    assert.ok(wi.known.some((k) => k.name === 'Lightning Bolt' && k.level === 3), 'SPELLLIST merged into known');
    assert.equal(wi.concentration, 11 + 3 + 2, 'Uncanny Concentration adds +2');
    assert.equal(checkPrepared(wiz, 'Wizard', [{ id: 'p1', name: 'Lightning Bolt', level: 4, metamagic: [], slot: 'normal' }]), true, 'can prepare lower-level spell in higher slot');
    wiz.runtime.prepared.Wizard = [{ id: 'p1', name: 'Lightning Bolt', level: 6, metamagic: ['Widen Spell'], slot: 'normal', cast: false }];
    const lbPlan = planCast(wiz, { className: 'Wizard', preparedId: 'p1' });
    assert.ok(typeof lbPlan !== 'string', `expected CastPlan, got ${String(lbPlan)}`);
    const lbCard = spellCard(wiz, lbPlan);
    assert.equal(lbCard.area?.feet, 120, 'Widen Spell does NOT double line spells');
    assert.ok(lbCard.rolls.some((r) => /defensive/i.test(r.label) && r.bonus === wi.concentration + 4), 'Combat Casting roll surfaced');
    assert.match(lookupSpell('Chain Lightning')?.text ?? '', /primary and secondary/i);

    // Skills: Trapfinding Disable Device always-on, Investigator Alchemy & True Inspiration
    const inv = pcgChar({ classes: ['CLASS:Investigator|LEVEL:20|SKILLPOOL:0'], stats: { INT: 16, DEX: 14 }, extra: ['SKILL:Craft (Alchemy)|RANK:1', 'SKILL:Disable Device|RANK:1'] });
    const sk = computeSkills(inv, computeCharacterStats(inv));
    const dd = sk.rows.find((r) => r.name === 'Disable Device')!;
    assert.ok(dd.total.parts.some((p) => p.source === 'Trapfinding' && p.value === 10), 'Trapfinding Disable Device always-on');
    assert.ok(!situationalFor(inv, computeCharacterStats(inv), dd).some((s) => s.id === 'trapfinding'), 'Trapfinding no longer duplicated as situational on Disable Device');
    const ca = sk.rows.find((r) => r.name === 'Craft (Alchemy)')!;
    assert.ok(situationalFor(inv, computeCharacterStats(inv), ca).some((s) => s.id === 'alchemy' && s.bonus === 20));
    const insp = situationalFor(inv, computeCharacterStats(inv), dd).find((s) => s.id === 'inspiration')!;
    assert.equal(insp.bonus, '2d6');
    assert.equal(insp.spendActionId, null);

    // Gear: Mithral / Darkwood / Adamantine + Kikko/Madu ASF + sizedDamage FAQ + TwoHandsOnly + Wand sellValueCp
    const mBp = detectGear('Mithral Breastplate').armor!;
    assert.equal(mBp.category, 'light');
    assert.equal(mBp.maxDex, 5);
    assert.equal(mBp.acp, -1);
    assert.equal(mBp.asf, 15);
    const dwSh = detectGear('Darkwood Heavy wooden shield').armor!;
    assert.equal(dwSh.acp, 0);
    assert.equal(detectGear('Adamantine Longsword').weapon?.masterwork, true);
    assert.equal(lookupArmor('Kikko')?.armor.asf, 20);
    assert.equal(lookupArmor('Madu')?.armor.asf, 5);
    assert.equal(sizedDamage('2d10', 'Large'), '4d8');
    assert.equal(sizedDamage('2d10', 'Small'), '2d8');
    assert.equal(sizedDamage('3d6', 'Small'), '2d8');

    const bowRec: EquipmentRecord = {
      kind: 'equipment', key: 'Longbow', name: 'Longbow',
      source: { campaign: 'Core Rulebook', long: 'Core Rulebook', short: 'CR', page: null },
      desc: '', types: ['Weapon', 'Martial', 'Ranged', 'Bow'], cost: 75, weight: 3, baseItem: null,
      damage: '1d8', critRange: 1, critMult: 3, range: 100, wield: 'TwoHandsOnly',
      acBonus: null, maxDex: null, acp: null, asf: null, slot: 'none', cl: null, aura: null, eqmods: [], spellEffect: null,
    };
    assert.equal(weaponFromRecord(bowRec)?.hands, 'two');
    assert.equal(sellValueCp({ value: 750, tradeGood: false, name: 'Wand of Cure Light Wounds', charges: { current: 10, max: 50 } }, 1), 7500, '10/50 wand sells for 75 gp (7500 cp)');
    assert.equal(sellValueCp({ value: 8000, tradeGood: false, name: 'Staff of Fire', charges: { current: 2, max: 10 } }, 1), 400000, 'staff keeps full 50% resale value');
  });

  test('Epic 13 rulesSnapshot & buildPack: Druid Nature Sense no double-count, alternate racial traits kept, stackable FCB HP, Luckstone/Boots bonuses, Catalog add-free with bonuses', () => {
    // parseStaticBonuses: Global_LuckBonus, POSTMOVEADD, all-skills
    const luckBonuses = parseStaticBonuses(
      [
        'BONUS:CHECKS|ALL|1+Global_LuckBonus|TYPE=Luck',
        'BONUS:SKILL|TYPE.Strength,TYPE.Dexterity,TYPE.Constitution,TYPE.Intelligence,TYPE.Wisdom,TYPE.Charisma|1+Global_LuckBonus|TYPE=Luck',
      ],
      'equipment',
      ['Magic', 'Wondrous'],
    );
    assert.ok(luckBonuses.some((b) => b.target === 'saves' && b.value === 1 && b.type === 'luck'));
    assert.ok(luckBonuses.some((b) => b.target === 'skills' && b.value === 1 && b.type === 'luck'));
    const boots = parseStaticBonuses(['BONUS:POSTMOVEADD|TYPE.Walk|10|TYPE=Enhancement'], 'equipment', ['Magic', 'Wondrous']);
    assert.deepEqual(boots, [{ target: 'speed', value: 10, type: 'enhancement' }]);

    // Druid Nature Sense not double-counted; alternate racial trait kept; FCB HP stacked
    const druidAb: FeatRecord = {
      kind: 'ability', key: 'Druid ~ Nature Sense', name: 'Nature Sense',
      source: { campaign: 'Core Rulebook', long: 'CR', short: 'CR', page: null },
      desc: '', types: ['SpecialQuality'], category: 'Special Ability', benefit: '', prereqs: '',
      bonuses: [
        { target: 'skill', skill: 'Knowledge (Nature)', value: 2, type: 'untyped' },
        { target: 'skill', skill: 'Survival', value: 2, type: 'untyped' },
      ],
    };
    const dualMinded: FeatRecord = {
      kind: 'ability', key: 'Half-Elf ~ Dual Minded', name: 'Dual Minded',
      source: { campaign: 'APG', long: 'APG', short: 'APG', page: null },
      desc: '', types: ['RacialTraits', 'Half-Elf Racial Trait'], category: 'Special Ability', benefit: '', prereqs: '',
      bonuses: [{ target: 'will', value: 2, type: 'untyped' }],
    };
    const fcbHp: FeatRecord = {
      kind: 'ability', key: 'Favored Class Bonus ~ Hit Point', name: 'Hit Point',
      source: { campaign: 'Core Rulebook', long: 'CR', short: 'CR', page: null },
      desc: '', types: ['FavoredClassBonus'], category: 'Special Ability', benefit: '', prereqs: '',
      bonuses: [{ target: 'hp', value: 1, type: 'untyped' }],
    };
    const cloakRec: EquipmentRecord = {
      kind: 'equipment', key: 'Cloak of Resistance +2', name: 'Cloak of Resistance +2',
      source: { campaign: 'Core Rulebook', long: 'Core Rulebook', short: 'CR', page: null },
      desc: '', types: ['Magic', 'Wondrous'], cost: 4000, weight: 1, baseItem: null,
      damage: null, critRange: null, critMult: null, range: null, wield: null,
      acBonus: null, maxDex: null, acp: null, asf: null, slot: 'shoulders', cl: 5, aura: 'faint abjuration', eqmods: [], spellEffect: null,
      bonuses: [{ target: 'saves', value: 2, type: 'resistance' }],
    };
    const mockRules: RulesProvider = {
      loaded: true,
      get: (k, key) => {
        if (k === 'ability' && key === druidAb.key) return druidAb as never;
        if (k === 'ability' && key === dualMinded.key) return dualMinded as never;
        if (k === 'ability' && key === fcbHp.key) return fcbHp as never;
        if (k === 'equipment' && key === cloakRec.key) return cloakRec as never;
        return undefined;
      },
      byName: () => undefined,
    };
    const druid = pcgChar({
      race: 'Half-Elf',
      classes: ['CLASS:Druid|LEVEL:5|SKILLPOOL:0'],
      extra: [
        'ABILITY:Special Ability|TYPE:NORMAL|CATEGORY:Special Ability|KEY:Druid ~ Nature Sense',
        'ABILITY:Special Ability|TYPE:NORMAL|CATEGORY:Special Ability|KEY:Half-Elf ~ Dual Minded',
        'ABILITY:Special Ability|TYPE:NORMAL|CATEGORY:Special Ability|KEY:Favored Class Bonus ~ Hit Point|APPLIEDTO:Druid|APPLIEDTO:Druid|APPLIEDTO:Druid',
      ],
    });
    const snap = buildCharacterRulesData(druid.build, mockRules);
    assert.ok(!snap.bonuses.some((b) => b.skill === 'Survival'), 'Druid Nature Sense suppressed from rulesData.bonuses');
    assert.ok(snap.bonuses.some((b) => b.target === 'will' && b.value === 2), 'Alternate racial trait Dual Minded preserved');
    assert.ok(snap.bonuses.some((b) => b.target === 'hp' && b.value === 3), 'Favored Class Bonus ~ Hit Point scaled ×3');

    // Catalog "Add free" works for magic items with static bonuses via inventory/buyItem { free: true }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vtt-r2-free-'));
    try {
      const store = new SqliteRoomStore(path.join(dir, 'vtt.db'));
      const room = new Room('main', createInitialState('sc1'), store, { autoIntervalMs: 1e12, keepAllForMs: 1e12, keepDailyForMs: 1e12 }, () => mockRules);
      const gm: Client = { id: newId(), user: null, room: null, seq: 0, send: () => {} };
      room.join(gm, { id: 'gm', name: 'GM', role: 'gm', color: '#ffffff' });
      druid.ownerId = 'gm';
      room.handleClientAction(gm, newId(), characterActions.import.create({ character: druid }));
      room.handleClientAction(
        gm,
        newId(),
        inventoryActions.buyItem.create({ characterId: druid.id, itemId: 'cloak1', quantity: 1, ruleKey: cloakRec.key, free: true }),
      );
      const added = room.currentState.characters[druid.id]!.inventory.items.find((i) => i.id === 'cloak1');
      assert.ok(added, 'free catalog add succeeded for item with static bonuses');
      assert.equal(added!.bonuses.length, 1);
      assert.equal(room.currentState.characters[druid.id]!.inventory.coins.gp, 0, 'no coins deducted');
      store.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }

    // packStore prefers canonical Core Rulebook spell over Occultist Spell copy
    const packDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vtt-pack-pref-'));
    try {
      fs.writeFileSync(
        path.join(packDir, 'manifest.json'),
        JSON.stringify({
          format: 'vtt-rules-pack', version: 1, builtAt: 1, from: 'test',
          counts: { equipment: 0, equipmod: 0, spell: 2, feat: 0, ability: 0, deity: 0, domain: 0, class: 0, race: 0 },
          books: [{ key: 'Core Rulebook', name: 'Core Rulebook', short: 'CR', publisher: 'Paizo', bookType: 'Core', records: 1 }],
          warnings: [],
        }),
      );
      fs.writeFileSync(
        path.join(packDir, 'spell.json'),
        JSON.stringify([
          { kind: 'spell', key: 'Occultist Spell ~ Fireball', name: 'Fireball', source: { campaign: 'Occult Adventures', long: 'OA', short: 'OA', page: null }, desc: '', types: [], school: 'Evocation', subschool: null, descriptors: [], classes: { Occultist: 3 }, domains: {}, castTime: null, components: null, range: null, targetArea: null, duration: null, save: null, sr: null },
          { kind: 'spell', key: 'Fireball', name: 'Fireball', source: { campaign: 'Core Rulebook', long: 'Core Rulebook', short: 'CR', page: null }, desc: '', types: [], school: 'Evocation', subschool: null, descriptors: [], classes: { Wizard: 3, Sorcerer: 3 }, domains: {}, castTime: null, components: null, range: null, targetArea: null, duration: null, save: null, sr: null },
        ]),
      );
      const ps = createRulesPackStore(packDir);
      assert.equal(ps.byName('spell', 'fireball')?.key, 'Fireball', 'Core canonical spell beats Occultist copy');
    } finally {
      fs.rmSync(packDir, { recursive: true, force: true });
    }
  });
});
