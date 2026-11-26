import assert from 'node:assert/strict';
import fs from 'node:fs';
import { describe, test } from 'node:test';
import {
  computeCharacterStats,
  computeSkills,
  createCharacterFromPcg,
  createInitialState,
  CURRENT_SCHEMA_VERSION,
  makeItem,
  migrateState,
  newId,
  parsePcg,
  situationalFor,
  skillRollExpression,
  type Character,
} from '@vtt/shared';

const SAMPLE = fs.readFileSync(new URL('./fixtures/sample-pf1e.pcg', import.meta.url), 'utf8');
const withLines = (pcg: string, ...lines: string[]) => `${pcg}\n${lines.join('\n')}\n`;

function character(pcg = SAMPLE): Character {
  return createCharacterFromPcg(parsePcg(pcg), { id: newId(), ownerId: 'alice', fileName: 'v.pcg', importedBy: 'alice', now: 1 });
}
const skills = (c: Character) => computeSkills(c, computeCharacterStats(c));
const row = (c: Character, name: string) => skills(c).rows.find((r) => r.name === name)!;

describe('PF1e skills', () => {
  test('ranks, class skill +3, ability; trained-only skills need ranks', () => {
    const c = character();
    // Str 17 (+3), Dex 15 (+2), Int 10, Wis 12 (+1).
    assert.equal(row(c, 'Climb').total.total, 2 + 3 + 3, '2 ranks + class skill + Str');
    assert.equal(row(c, 'Perception').total.total, 2 + 1, 'not a class skill: no +3');
    assert.equal(row(c, 'Knowledge (Arcana)').total.total, 1 + 3, 'Wizard class skill, Int +0');
    assert.equal(row(c, 'Knowledge (Arcana)').usable, true);
    assert.equal(row(c, 'Knowledge (Planes)').usable, false, 'trained only, no ranks');
    assert.equal(row(c, 'Disable Device').usable, false);
    assert.equal(row(c, 'Acrobatics').total.total, 2, 'untrained: just Dex');
    assert.equal(skills(c).totalRanks, 5);
    assert.equal(skills(c).maxRanks, 3);
  });

  test('PCGen pseudo-entries are hidden; sub-skills from the file are listed', () => {
    const c = character(
      withLines(SAMPLE, 'SKILL:Untrained Wisdom|OUTPUTORDER:40|', 'SKILL:Bluff (Perform (Act))|OUTPUTORDER:41|', 'SKILL:Profession (Sailor)|OUTPUTORDER:42|CLASSBOUGHT:[CLASS:Fighter|RANKS:1.0|COST:1|CLASSSKILL:Y]'),
    );
    const names = skills(c).rows.map((r) => r.name);
    assert.ok(!names.includes('Untrained Wisdom'));
    assert.ok(!names.includes('Bluff (Perform (Act))'));
    assert.equal(row(c, 'Profession (Sailor)').total.total, 1 + 3 + 1, 'Profession uses Wis');
    assert.ok(names.includes('Knowledge (Local)'), 'all ten Knowledges listed');
  });

  test('armor check penalty, size, race and feats', () => {
    const c = character(
      withLines(
        SAMPLE.replace('RACE:Human', 'RACE:Halfling'),
        'ABILITY:FEAT|TYPE:NORMAL|CATEGORY:FEAT|KEY:Alertness',
        'FEAT:Skill Focus (Stealth)',
      ),
    );
    c.inventory.items.push(makeItem({ id: 'mail', name: 'Chainmail', armor: { kind: 'armor', category: 'medium', bonus: 6, enhancement: 0, maxDex: 2, acp: -5, asf: 30 } }));
    c.inventory.loadouts[0]!.slots.mail = 'armor';
    const stealth = row(c, 'Stealth');
    const parts = Object.fromEntries(stealth.total.parts.map((p) => [p.source, p.value]));
    assert.equal(parts.Small, 4, 'Small: +4 Stealth');
    assert.equal(parts['Skill Focus'], 3);
    assert.equal(parts['Armor check penalty'], -5);
    assert.equal(row(c, 'Perception').total.parts.find((p) => p.source === 'Halfling')?.value, 2, 'halfling keen senses');
    assert.equal(row(c, 'Sense Motive').total.parts.find((p) => p.source === 'Alertness')?.value, 2);
    assert.equal(row(c, 'Appraise').total.parts.some((p) => p.source === 'Armor check penalty'), false, 'no ACP on Int skills');
  });

  test('sheet overrides: ranks, misc, class skill, favorites and custom sub-skills', () => {
    const c = character();
    c.sheet.skills = {
      Perception: { ranks: 3, misc: 2, classSkill: true, favorite: true, custom: false },
      'Craft (Bows)': { ranks: 1, misc: 0, classSkill: null, favorite: false, custom: true },
    };
    const p = row(c, 'Perception');
    assert.equal(p.total.total, 3 + 3 + 1 + 2);
    assert.equal(p.fileRanks, 2);
    assert.equal(p.favorite, true);
    assert.equal(row(c, 'Craft (Bows)').total.total, 1, 'custom sub-skill with Int +0');
    c.sheet.skills = { Climb: { ranks: null, misc: 0, classSkill: false, favorite: false, custom: false } };
    assert.equal(row(c, 'Climb').total.total, 2 + 3, 'class skill turned off');
    c.sheet.skills = { Perception: { ranks: 9, misc: 0, classSkill: null, favorite: false, custom: false } };
    assert.ok(skills(c).warnings.some((w) => w.includes('more than your 3 hit dice')));
  });

  test('class features and situational bonuses', () => {
    const inv = character(SAMPLE.replace('CLASS:Wizard|LEVEL:1', 'CLASS:Investigator|LEVEL:1').replace('CLASSABILITIESLEVEL:Wizard=1', 'CLASSABILITIESLEVEL:Investigator=1'));
    const stats = computeCharacterStats(inv);
    const perception = situationalFor(inv, stats, row(inv, 'Perception'));
    assert.deepEqual(perception.map((x) => x.id), ['trapfinding', 'inspiration']);
    assert.equal(perception.find((x) => x.id === 'inspiration')!.spendActionId, 'c.investigator.inspire', 'untrained-list skill costs a point');
    const arcana = situationalFor(inv, stats, row(inv, 'Knowledge (Arcana)'));
    assert.equal(arcana.find((x) => x.id === 'inspiration')!.spendActionId, null, 'free on trained Knowledge');

    const bard = character(SAMPLE.replace('CLASS:Wizard|LEVEL:1', 'CLASS:Bard|LEVEL:1').replace('CLASSABILITIESLEVEL:Wizard=1', 'CLASSABILITIESLEVEL:Bard=1'));
    assert.equal(row(bard, 'Knowledge (Planes)').usable, true, 'bardic knowledge: untrained Knowledge');
    assert.ok(row(bard, 'Knowledge (Planes)').total.parts.some((p) => p.source === 'Bardic knowledge'));

    assert.equal(skillRollExpression(7, []), '1d20+7');
    assert.equal(skillRollExpression(7, [1, '1d6'], 10), '10+1d6+8');
    assert.equal(skillRollExpression(-2, [], 20), '20-2');
  });

  test('v7 -> v8 migration adds skill overrides', () => {
    const state = createInitialState('s1');
    const c = character() as Record<string, unknown> & { sheet: Record<string, unknown> };
    delete c.sheet.skills;
    const migrated = migrateState({ ...state, schemaVersion: 7, characters: { x: c } });
    assert.equal(migrated.schemaVersion, CURRENT_SCHEMA_VERSION);
    assert.deepEqual(Object.values(migrated.characters)[0]!.sheet.skills, {});
  });

  test('deduplicates duplicate feats, floors fractional ranks, merges skill casing, and respects class/race rules', () => {
    // Duplicate Alertness (ABILITY + VFEAT) and Skill Focus (ABILITY + FEAT) only count once.
    const dup = character(
      withLines(
        SAMPLE,
        'ABILITY:FEAT|TYPE:NORMAL|CATEGORY:FEAT|KEY:Alertness',
        'VFEAT:Alertness',
        'ABILITY:FEAT|TYPE:NORMAL|CATEGORY:FEAT|KEY:Skill Focus|APPLIEDTO:Knowledge(Arcana)',
        'FEAT:Skill Focus (Knowledge (Arcana))',
        'SKILL:Knowledge (arcana)|OUTPUTORDER:13|CLASSBOUGHT:[CLASS:Wizard|RANKS:0.5|COST:1|CLASSSKILL:Y]',
      ),
    );
    const arcanaRows = skills(dup).rows.filter((r) => r.name.toLowerCase() === 'knowledge (arcana)');
    assert.equal(arcanaRows.length, 1, 'case-differing Knowledge (arcana) merges into Knowledge (Arcana)');
    assert.equal(row(dup, 'Perception').total.parts.filter((p) => p.source === 'Alertness').length, 1);
    assert.equal(row(dup, 'Knowledge (Arcana)').total.parts.filter((p) => p.source === 'Skill Focus').length, 1);
    assert.equal(skillRollExpression(3.5, []), '1d20+3', 'truncates fractional totals');

    // Hunter does not get Track at level 1, gains it at level 2.
    const hunter1 = character(SAMPLE.replace('CLASS:Wizard|LEVEL:1', 'CLASS:Hunter|LEVEL:1').replace('CLASSABILITIESLEVEL:Wizard=1', 'CLASSABILITIESLEVEL:Hunter=1'));
    assert.equal(situationalFor(hunter1, computeCharacterStats(hunter1), row(hunter1, 'Survival')).some((x) => x.id === 'track'), false);
    const hunter2 = character(SAMPLE.replace('CLASS:Wizard|LEVEL:1', 'CLASS:Hunter|LEVEL:2').replace('CLASSABILITIESLEVEL:Wizard=1', 'CLASSABILITIESLEVEL:Hunter=2'));
    assert.equal(situationalFor(hunter2, computeCharacterStats(hunter2), row(hunter2, 'Survival')).some((x) => x.id === 'track'), true);

    // Inquisitor with Wis <= 10 does not get a +0/negative Monster Lore toggle.
    const lowWisInq = character(
      SAMPLE.replace('CLASS:Wizard|LEVEL:1', 'CLASS:Inquisitor|LEVEL:1')
        .replace('CLASSABILITIESLEVEL:Wizard=1', 'CLASSABILITIESLEVEL:Inquisitor=1')
        .replace('STAT:WIS|SCORE:12', 'STAT:WIS|SCORE:8'),
    );
    assert.equal(situationalFor(lowWisInq, computeCharacterStats(lowWisInq), row(lowWisInq, 'Knowledge (Arcana)')).some((x) => x.id === 'monsterlore'), false);

    // Racial skill bonuses: Ratfolk surfaces Craft (Alchemy); Grippli has no always-on racial Stealth; Tengu gets +4 Linguistics.
    const rat = character(SAMPLE.replace('RACE:Human', 'RACE:Ratfolk'));
    assert.equal(row(rat, 'Craft (Alchemy)').total.parts.find((p) => p.source === 'Ratfolk')?.value, 2);
    const grippli = character(SAMPLE.replace('RACE:Human', 'RACE:Grippli'));
    assert.equal(row(grippli, 'Stealth').total.parts.find((p) => p.source === 'Grippli'), undefined);
    const tengu = character(SAMPLE.replace('RACE:Human', 'RACE:Tengu'));
    assert.equal(row(tengu, 'Linguistics').total.parts.find((p) => p.source === 'Tengu')?.value, 4);
  });
});
