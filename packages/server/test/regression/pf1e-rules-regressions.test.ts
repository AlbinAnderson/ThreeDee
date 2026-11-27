import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  characterSpellcasting,
  computeCharacterStats,
  computeSkills,
  containerContentsWeight,
  createInitialState,
  detectGear,
  effectiveConditions,
  effectiveTurn,
  lookupArmor,
  lookupPf1Action,
  lookupPreset,
  lookupSpell,
  makeItem,
  parseGpValue,
  parsePcg,
  presetBuff,
  presetsFor,
  seedInventory,
  situationalFor,
  sizedDamage,
  skillRollExpression,
} from '@vtt/shared';
import { casterPcg, makePcgCharacter, SAMPLE_PCG, withPcgLines } from '../helpers/harness';

describe('regression: PF1e rules fixes across Epics 1-5', () => {
  test('[Epic 2] ability damage applies -1 per 2 points on even scores without altering score', () => {
    const c = makePcgCharacter(SAMPLE_PCG); // CON 14 (+2)
    c.runtime.abilityDamage.CON = 1;
    assert.equal(computeCharacterStats(c).abilities.CON.score, 14);
    assert.equal(computeCharacterStats(c).abilities.CON.mod, 2, '1 damage on even score does not penalize');
    c.runtime.abilityDamage.CON = 3;
    assert.equal(computeCharacterStats(c).abilities.CON.mod, 1, '3 damage applies -1');
  });

  test('[Epic 2 & 4] Fleet stops in heavy armor; 40 ft speed in heavy armor -> 30 ft; 0 ft speed stays 0; armorBonus=0 clears ACP/ASF', () => {
    const c = makePcgCharacter(withPcgLines(SAMPLE_PCG, 'ABILITY:FEAT|TYPE:NORMAL|CATEGORY:FEAT|KEY:Fleet'));
    c.sheet.speed = null;
    // Base 40 ft speed (simulate by setting race to unknown + speed check via medium armor)
    c.inventory.items.push(makeItem({ id: 'plate', name: 'Full Plate', weight: 50, armor: { kind: 'armor', category: 'heavy', bonus: 9, enhancement: 0, maxDex: 1, acp: -6, asf: 35 } }));
    c.inventory.loadouts[0]!.slots.plate = 'armor';
    const heavy = computeCharacterStats(c);
    assert.equal(heavy.speed.total, 20, 'Fleet suppressed in heavy armor');
    assert.equal(heavy.armor.acp, -6);
    assert.equal(heavy.armor.asf, 35);

    c.sheet.armorBonus = 0;
    const noArmor = computeCharacterStats(c);
    assert.equal(noArmor.speed.total, 35, 'Fleet re-enabled when armorBonus overridden to 0');
    assert.equal(noArmor.armor.acp, 0);
    assert.equal(noArmor.armor.asf, 0);

    c.sheet.speed = 0;
    assert.equal(computeCharacterStats(c).speed.total, 5, '0 base speed + 5 Fleet (never negative)');
    c.sheet.armorBonus = null;
    assert.equal(computeCharacterStats(c).speed.total, 0, '0 base speed in heavy armor stays 0');
  });

  test('[Epic 2 & 5] duplicate feats do not double-count in engine or skills', () => {
    const c = makePcgCharacter(
      withPcgLines(
        SAMPLE_PCG,
        'ABILITY:FEAT|TYPE:NORMAL|CATEGORY:FEAT|KEY:Iron Will',
        'FEAT:Iron Will',
        'ABILITY:FEAT|TYPE:NORMAL|CATEGORY:FEAT|KEY:Alertness',
        'VFEAT:Alertness',
        'ABILITY:FEAT|TYPE:NORMAL|CATEGORY:FEAT|KEY:Skill Focus|APPLIEDTO:Perception',
        'FEAT:Skill Focus (Perception)',
      ),
    );
    const stats = computeCharacterStats(c);
    assert.equal(stats.saves.will.parts.filter((p) => p.source.toLowerCase().includes('iron will')).length, 1);
    const perc = computeSkills(c, stats).rows.find((r) => r.name === 'Perception')!;
    assert.equal(perc.total.parts.filter((p) => p.source === 'Alertness').length, 1);
    assert.equal(perc.total.parts.filter((p) => p.source === 'Skill Focus').length, 1);
  });

  test('[Epic 3] action metadata: Investigator 2-pt Inspiration, Warpriest standard Blessing, Opportune Parry roll, Overrun movement', () => {
    assert.equal(lookupPf1Action('c.investigator.inspireattack')?.resourceCost, 2);
    assert.equal(lookupPf1Action('c.investigator.inspiresave')?.resourceCost, 2);
    assert.equal(lookupPf1Action('c.warpriest.blessing')?.cost, 'standard');
    assert.equal(lookupPf1Action('c.swashbuckler.parry')?.roll, 'melee');
    assert.equal(lookupPf1Action('g.overrun')?.movement, true);
  });

  test('[Epic 4] detectGear, sizedDamage, EQUIPSET:Equipped, parseGpValue and nested extradimensional container weight', () => {
    assert.equal(detectGear('Wand of Acid Arrow').weapon, null);
    assert.equal(detectGear('Potion of Resist Acid').weapon, null);
    assert.equal(detectGear('Composite Longbow (+2 Str)').weapon?.enhancement, 0);
    assert.equal(detectGear('Longbow (Composite)').weapon?.strDamage, 'full');
    assert.equal(detectGear('Sword (Short)').weapon?.damage, '1d6');
    assert.equal(sizedDamage('1d8', 'Huge'), '3d6');
    assert.equal(sizedDamage('2d6', 'Huge'), '4d6');
    assert.equal(parseGpValue('2,315 gp'), 2315);
    assert.equal(parseGpValue('3 gems'), 0);

    const inv = seedInventory(parsePcg(withPcgLines(SAMPLE_PCG, 'EQUIPNAME:Chainmail|OUTPUTORDER:4|COST:150|WT:40|QUANTITY:1.0', 'EQUIPSET:Equipped|ID:0.1.3|VALUE:Chainmail|QUANTITY:1.0')));
    assert.equal(inv.loadouts[0]!.slots[inv.items.find((i) => i.name === 'Chainmail')!.id], 'armor');

    const pack = inv.items.find((i) => i.name === 'Backpack')!;
    inv.items.push(
      makeItem({ id: 'boh', name: 'Bag of Holding', weight: 15, containerId: pack.id, container: { extradimensional: true, capacity: 250 } }),
      makeItem({ id: 'rock', name: 'Boulder', weight: 200, containerId: 'boh' }),
    );
    assert.equal(containerContentsWeight(inv, 'boh'), 200);
    assert.equal(containerContentsWeight(inv, pack.id), 5 + 15);
  });

  test('[Epic 5] fractional ranks, skill casing merge, Hunter L1 vs L2 Track, Wis<=10 Monster Lore, and AoN racial skills', () => {
    assert.equal(skillRollExpression(4.5, []), '1d20+4');
    const c = makePcgCharacter(
      withPcgLines(SAMPLE_PCG, 'SKILL:Knowledge (arcana)|OUTPUTORDER:13|CLASSBOUGHT:[CLASS:Wizard|RANKS:0.5|COST:1|CLASSSKILL:Y]'),
    );
    assert.equal(computeSkills(c, computeCharacterStats(c)).rows.filter((r) => r.name.toLowerCase() === 'knowledge (arcana)').length, 1);

    const h1 = makePcgCharacter(SAMPLE_PCG.replace('CLASS:Wizard|LEVEL:1', 'CLASS:Hunter|LEVEL:1').replace('CLASSABILITIESLEVEL:Wizard=1', 'CLASSABILITIESLEVEL:Hunter=1'));
    const h2 = makePcgCharacter(SAMPLE_PCG.replace('CLASS:Wizard|LEVEL:1', 'CLASS:Hunter|LEVEL:2').replace('CLASSABILITIESLEVEL:Wizard=1', 'CLASSABILITIESLEVEL:Hunter=2'));
    assert.equal(situationalFor(h1, computeCharacterStats(h1), computeSkills(h1, computeCharacterStats(h1)).rows.find((r) => r.name === 'Survival')!).some((x) => x.id === 'track'), false);
    assert.equal(situationalFor(h2, computeCharacterStats(h2), computeSkills(h2, computeCharacterStats(h2)).rows.find((r) => r.name === 'Survival')!).some((x) => x.id === 'track'), true);

    const inq = makePcgCharacter(
      SAMPLE_PCG.replace('CLASS:Wizard|LEVEL:1', 'CLASS:Inquisitor|LEVEL:1')
        .replace('CLASSABILITIESLEVEL:Wizard=1', 'CLASSABILITIESLEVEL:Inquisitor=1')
        .replace('STAT:WIS|SCORE:12', 'STAT:WIS|SCORE:10'),
    );
    assert.equal(situationalFor(inq, computeCharacterStats(inq), computeSkills(inq, computeCharacterStats(inq)).rows.find((r) => r.name === 'Knowledge (Arcana)')!).some((x) => x.id === 'monsterlore'), false);

    for (const [race, skill, expected] of [
      ['Suli', 'Diplomacy', 2],
      ['Vanara', 'Acrobatics', 2],
      ['Wayang', 'Stealth', 2],
      ['Tengu', 'Linguistics', 4],
      ['Ratfolk', 'Craft (Alchemy)', 2],
      ['Android', 'Sense Motive', -4],
    ] as const) {
      const rc = makePcgCharacter(SAMPLE_PCG.replace('RACE:Human', `RACE:${race}`));
      const r = computeSkills(rc, computeCharacterStats(rc)).rows.find((x) => x.name === skill)!;
      assert.equal(r.total.parts.find((p) => p.source === race)?.value, expected, `${race} ${skill}`);
    }
    const grippli = makePcgCharacter(SAMPLE_PCG.replace('RACE:Human', 'RACE:Grippli'));
    assert.equal(computeSkills(grippli, computeCharacterStats(grippli)).rows.find((x) => x.name === 'Stealth')!.total.parts.find((p) => p.source === 'Grippli'), undefined);
  });

  test('[Rules audit] Inspired Rage (-1 AC, Will +1/4 lvls), Pinned supersedes Grappled, Bloodrager rage preset', () => {
    const skald = (level: number) => makePcgCharacter(casterPcg({ classes: [`CLASS:Skald|LEVEL:${level}|SKILLPOOL:0`] }));
    const ir = lookupPreset('inspiredRage')!;
    const fxAt = (level: number) => presetBuff(skald(level), ir, undefined, { mod: () => 0 }, `ir-${level}`).effects;
    assert.deepEqual(
      fxAt(1).map((x) => [x.target, x.value, x.type]),
      [
        ['STR', 2, 'morale'],
        ['CON', 2, 'morale'],
        ['will', 1, 'morale'],
        ['ac', -1, 'untyped'],
      ],
    );
    assert.deepEqual(
      fxAt(4).map((x) => [x.target, x.value]),
      [
        ['STR', 2],
        ['CON', 2],
        ['will', 2],
        ['ac', -1],
      ],
    );
    assert.deepEqual(
      fxAt(12).map((x) => [x.target, x.value]),
      [
        ['STR', 4],
        ['CON', 4],
        ['will', 4],
        ['ac', -1],
      ],
    );
    assert.deepEqual(
      fxAt(20).map((x) => [x.target, x.value]),
      [
        ['STR', 6],
        ['CON', 6],
        ['will', 6],
        ['ac', -1],
      ],
    );

    // Pinned supersedes Grappled (do not stack).
    assert.deepEqual(effectiveConditions(['Grappled', 'Pinned']), ['pinned']);
    const c = makePcgCharacter();
    const base = computeCharacterStats(c);
    c.runtime.conditions = ['Grappled', 'Pinned'];
    const pinned = computeCharacterStats(c);
    assert.equal(pinned.abilities.DEX.score, base.abilities.DEX.score, 'Pinned does not also apply Grappled -4 Dex');
    assert.equal(pinned.attacks[0]!.attack.total, base.attacks[0]!.attack.total, 'Pinned does not stack Grappled -2 attack');
    assert.equal(pinned.ac.normal.total, base.ac.flatFooted.total - 4);

    // Bloodrager gets Rage preset and scales Greater/Mighty Bloodrage at 11/20.
    const br11 = makePcgCharacter(casterPcg({ classes: ['CLASS:Bloodrager|LEVEL:11|SKILLPOOL:0'] }));
    assert.ok(presetsFor(br11).some((p) => p.id === 'rage'));
    const brFx = presetBuff(br11, lookupPreset('rage')!, undefined, { mod: () => 0 }, 'br').effects;
    assert.deepEqual(
      brFx.filter((x) => x.target === 'STR' || x.target === 'will').map((x) => x.value),
      [6, 3],
    );
  });

  test('[Rules audit] Shaman spirit bonus slot, Virtue save=none, armor/weapon/race tables, virtualFeats & multi-target Skill Focus', () => {
    const shaman = makePcgCharacter(casterPcg({ classes: ['CLASS:Shaman|LEVEL:3|SKILLPOOL:0'], stats: { WIS: 16 } }));
    const shInfo = characterSpellcasting(shaman)[0]!;
    assert.equal(shInfo.bonusSlot, 'spirit');
    assert.equal(shInfo.levels.find((l) => l.level === 1)?.extra, 1);
    assert.equal(shInfo.levels.find((l) => l.level === 2)?.extra, 1);
    assert.equal(shInfo.levels.find((l) => l.level === 0)?.extra, 0);

    assert.equal(lookupSpell('Virtue')?.save, 'none');

    // Armor corrections
    assert.equal(lookupArmor('Leather lamellar')?.armor.asf, 20);
    assert.equal(lookupArmor('Stoneplate')?.armor.maxDex, 1);
    assert.equal(lookupArmor('Stoneplate')?.armor.asf, 35);
    assert.equal(lookupArmor('O-yoroi')?.armor.acp, -6);
    assert.equal(lookupArmor('O-yoroi')?.armor.asf, 35);

    // Weapon corrections & PCGen alias
    assert.equal(detectGear('Sai').weapon?.range, 0);
    assert.equal(detectGear('Gnome hooked hammer').weapon?.damage, '1d8');
    assert.equal(detectGear('Crossbow (Repeating Light)').weapon?.damage, '1d8');
    assert.equal(detectGear('Crossbow (Repeating Light)').weapon?.range, 80);

    // Nagaji racial Perception +2
    const nagaji = makePcgCharacter(SAMPLE_PCG.replace('RACE:Human', 'RACE:Nagaji'));
    const nPerc = computeSkills(nagaji, computeCharacterStats(nagaji)).rows.find((x) => x.name === 'Perception')!;
    assert.equal(nPerc.total.parts.find((p) => p.source === 'Nagaji')?.value, 2);

    // Comma-separated legacy/virtual Skill Focus targets
    const sf = makePcgCharacter(withPcgLines(SAMPLE_PCG, 'VFEAT:Skill Focus (Perception, Stealth)'));
    const sfSkills = computeSkills(sf, computeCharacterStats(sf)).rows;
    assert.equal(sfSkills.find((r) => r.name === 'Perception')!.total.parts.find((p) => p.source === 'Skill Focus')?.value, 3);
    assert.equal(sfSkills.find((r) => r.name === 'Stealth')!.total.parts.find((p) => p.source === 'Skill Focus')?.value, 3);

    // Virtual Combat Reflexes in action economy
    const crChar = makePcgCharacter(withPcgLines(SAMPLE_PCG, 'VFEAT:Combat Reflexes'));
    crChar.tokenId = 'tok-cr';
    const state = createInitialState('s1');
    state.characters[crChar.id] = crChar;
    state.combat = {
      ...state.combat,
      active: true,
      round: 1,
      currentId: 'cb-1',
      combatants: [{ id: 'cb-1', tokenId: 'tok-cr', name: crChar.name, initiative: 15, modifier: 0, hidden: false }],
    };
    const turn = effectiveTurn(state, 'cb-1');
    assert.equal(turn.combatReflexes, true);
    assert.equal(turn.aooMax, 1 + computeCharacterStats(crChar).abilities.DEX.mod);
  });
});
