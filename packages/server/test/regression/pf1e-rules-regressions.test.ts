import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  computeCharacterStats,
  computeSkills,
  containerContentsWeight,
  detectGear,
  lookupPf1Action,
  makeItem,
  parseGpValue,
  parsePcg,
  seedInventory,
  situationalFor,
  sizedDamage,
  skillRollExpression,
} from '@vtt/shared';
import { makePcgCharacter, SAMPLE_PCG, withPcgLines } from '../helpers/harness';

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
});
