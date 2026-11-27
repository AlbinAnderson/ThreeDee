import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import {
  applyRecordToItem,
  buildCharacterRulesData,
  characterSpellcasting,
  computeCharacterStats,
  computeSkills,
  itemFromRecord,
  lookupPreset,
  makeItem,
  presetBuff,
  spellDc,
  type Character,
  type EquipmentRecord,
  type PresetContext,
  type RulesProvider,
} from '@vtt/shared';
import { buildRulesPack, parseStaticBonuses } from '../../src/rules/buildPack';
import { RulesPackStore } from '../../src/rules/packStore';
import { casterPcg, makePcgCharacter } from '../helpers/harness';

const NO_MOD: PresetContext = { mod: () => 0 };

function makeTempPack(files: Record<string, string>): { store: RulesPackStore; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vtt-e13-'));
  const inDir = path.join(dir, 'in');
  const outDir = path.join(dir, 'out');
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(inDir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf8');
  }
  buildRulesPack(inDir, outDir);
  const store = new RulesPackStore(outDir);
  return { store, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

describe('[Epic 13.1] PCGen class and race ingestion', () => {
  test('parses multi-line CLASS definitions, .MOD, .COPY, .FORGET, level-line skipping, and BASEAB priority', () => {
    const { store, cleanup } = makeTempPack({
      'core.pcc': [
        'CAMPAIGN:Core Rulebook',
        'KEY:Core Rulebook',
        'SOURCELONG:Core Rulebook',
        'SOURCESHORT:CR',
        'PUBNAMELONG:Paizo Inc.',
        'BOOKTYPE:Core Rules',
        'CLASS:classes.lst',
        'ABILITY:abilities.lst',
        'RACE:races.lst',
      ].join('\n'),
      'classes.lst': [
        'CLASS:Arcane Trickster\tHD:6\tTYPE:PC.Prestige\tBONUS:COMBAT|BASEAB|classlevel("APPLIEDAS=NONEPIC")/2\tBONUS:SAVE|BASE.Reflex,BASE.Will|(classlevel("APPLIEDAS=NONEPIC")+1)/2\tBONUS:SAVE|BASE.Fortitude|(classlevel("APPLIEDAS=NONEPIC")+1)/3',
        'CLASS:Arcane Trickster\tSTARTSKILLPTS:4\tCSKILL:Acrobatics|Bluff|Disable Device|TYPE=Knowledge|Stealth',
        '1\tABILITY:Special Ability|AUTOMATIC|Ranged Legerdemain',
        '2\tBONUS:VAR|SneakAttackDice|1',
        // PCGen's Dragon Disciple has BASEAB *3/4 plus a buggy ClassBABFull: BASEAB must win.
        'CLASS:Dragon Disciple\tHD:12\tTYPE:PC.Prestige\tBONUS:COMBAT|BASEAB|classlevel("APPLIEDAS=NONEPIC")*3/4\tBONUS:SAVE|BASE.Fortitude,BASE.Will|(classlevel("APPLIEDAS=NONEPIC")+1)/2\tBONUS:VAR|ClassBABFull|classlevel("APPLIEDAS=NONEPIC")',
        'CLASS:Dragon Disciple\tSTARTSKILLPTS:2\tCSKILL:Diplomacy|Fly|Perception',
        // .MOD adds a class skill; .COPY clones; .FORGET removes.
        'CLASS:Dragon Disciple.MOD\tCSKILL:Spellcraft',
        'CLASS:Dragon Disciple.COPY=Wyrm Disciple\tHD:10',
        'CLASS:TempClass\tHD:8\tTYPE:PC\tBONUS:COMBAT|BASEAB|classlevel("APPLIEDAS=NONEPIC")',
        'CLASS:TempClass.FORGET',
      ].join('\n'),
      'abilities.lst': [
        '+2 Dexterity, +2 Charisma, -2 Constitution\tKEY:Gathlain ~ Ability Scores\tCATEGORY:Special Ability\tTYPE:RacialTraits.Gathlain Racial Default.Racial Ability Scores\tBONUS:STAT|DEX,CHA|2|TYPE=Racial\tBONUS:STAT|CON|-2|TYPE=Racial',
        'Low-Light Vision\tKEY:Gathlain ~ Vision\tCATEGORY:Special Ability\tTYPE:RacialTraits.Gathlain Racial Default\tVISION:Low-Light Vision',
        'Fey Agility\tKEY:Gathlain ~ Fey Agility\tCATEGORY:Special Ability\tTYPE:RacialTraits.Gathlain Racial Default\tBONUS:SKILL|Fly|2|TYPE=Racial',
        'Medium\tKEY:Tiefling ~ Size\tCATEGORY:Special Ability\tTYPE:RacialTraits.Tiefling Racial Default\tTEMPLATE:SIZE_M',
        'Slow and Steady\tKEY:Stonekin ~ Slow and Steady\tCATEGORY:Special Ability\tTYPE:RacialTraits.Stonekin Racial Default\tDESC:Your speed is never modified by armor or encumbrance.',
      ].join('\n'),
      'races.lst': [
        'Gathlain\tFACT:BaseSize|S\tMOVE:Walk,30\tTYPE:Base.PC',
        'Tiefling\tFACT:BaseSize|S\tMOVE:Walk,30\tTYPE:Base.PC',
        'Stonekin\tSIZE:M\tMOVE:Walk,20\tVISION:Darkvision (60\')\tBONUS:STAT|CON|2|TYPE=Racial\tBONUS:STAT|CHA|-2|TYPE=Racial\tBONUS:SKILL|Climb|2|TYPE=Racial|PRERACE:1,Stonekin',
      ].join('\n'),
    });
    try {
      const at = store.byName('class', 'Arcane Trickster')!;
      assert.equal(at.hd, 6);
      assert.equal(at.bab, 'half');
      assert.deepEqual(at.goodSaves.sort(), ['ref', 'will']);
      assert.equal(at.prestige, true);
      assert.equal(at.skillRanks, 4);
      assert.ok(at.classSkills.includes('Disable Device'));
      assert.ok(at.classSkills.includes('Knowledge (Arcana)'));

      const dd = store.byName('class', 'Dragon Disciple')!;
      assert.equal(dd.bab, 'threeQuarter', 'BASEAB *3/4 takes precedence over ClassBABFull');
      assert.ok(dd.classSkills.includes('Spellcraft'), '.MOD merged CSKILL');

      const wd = store.byName('class', 'Wyrm Disciple')!;
      assert.equal(wd.hd, 10, '.COPY cloned Dragon Disciple with HD:10');
      assert.equal(wd.bab, 'threeQuarter');
      assert.equal(store.byName('class', 'TempClass'), undefined, '.FORGET removed class');

      const gath = store.byName('race', 'Gathlain')!;
      assert.equal(gath.size, 'Small');
      assert.equal(gath.speed, 30);
      assert.deepEqual(gath.abilityMods, { DEX: 2, CHA: 2, CON: -2 });
      assert.equal(gath.lowLight, true);
      assert.deepEqual(gath.skillBonuses, { Fly: 2 });

      const tief = store.byName('race', 'Tiefling')!;
      assert.equal(tief.size, 'Medium', 'Tiefling ~ Size TEMPLATE:SIZE_M overrides BaseSize|S');

      const stone = store.byName('race', 'Stonekin')!;
      assert.equal(stone.steady, true);
      assert.equal(stone.darkvision, 60);
      assert.deepEqual(stone.abilityMods, { CON: 2, CHA: -2 });
      assert.deepEqual(stone.skillBonuses, {}, 'PRERACE-guarded bonus is rejected cleanly');
    } finally {
      cleanup();
    }
  });
});

describe('[Epic 13.2] Static PCGen BONUS: parser', () => {
  test('parses valid static bonuses including negatives and rejects PRE-guarded, decimal, formula, and armor/weapon duplicates', () => {
    const bonuses = parseStaticBonuses(
      [
        'BONUS:VAR|FortitudeSave_ResistanceBonus,ReflexSave_ResistanceBonus,WillSave_ResistanceBonus|2|TYPE=Resistance',
        'BONUS:COMBAT|AC|2|TYPE=NaturalArmorEnhancement',
        'BONUS:COMBAT|AC|1|TYPE=Deflection',
        'BONUS:COMBAT|INITIATIVE|2|TYPE=Trait',
        'BONUS:STAT|STR|-2|TYPE=Racial',
        'BONUS:SAVE|Reflex|1|TYPE=Trait',
        'BONUS:SKILL|Perception,Stealth|2|TYPE=Competence',
        'BONUS:MOVEADD|TYPE=Walk|10|TYPE=Enhancement',
        // Rejected cases:
        'BONUS:SKILL|Climb|2|TYPE=Racial|PRERACE:1,Dwarf',
        'BONUS:COMBAT|AC|1|TYPE=Dodge|!PREABILITY:1,CATEGORY=Special Ability,Foo',
        'BONUS:STAT|CON|1.5|TYPE=Enhancement',
        'BONUS:MOVEADD|TYPE=Walk|MonkFastMovementBonus|TYPE=Enhancement',
        'BONUS:SKILL|TYPE=Knowledge|2|TYPE=Competence',
        'BONUS:STAT|LIST|2',
        'BONUS:VAR|UnknownCustomVar|4',
        'BONUS:SAVE|BASE.Fortitude|2',
        'BONUS:HP|CURRENTMAX|%CHOICE',
        // Unmapped TYPE= (e.g. ArmorEnhancement, ShieldEnhancement) must be rejected instead of falling through to 'untyped'.
        'BONUS:COMBAT|AC|2|TYPE=ArmorEnhancement',
        'BONUS:COMBAT|AC|2|TYPE=ShieldEnhancement',
      ],
      'equipment',
      ['Magic', 'Wondrous'],
    );
    assert.deepEqual(bonuses, [
      { target: 'saves', value: 2, type: 'resistance' },
      { target: 'ac', value: 2, type: 'enhancement' },
      { target: 'ac', value: 1, type: 'deflection' },
      { target: 'initiative', value: 2, type: 'trait' },
      { target: 'STR', value: -2, type: 'racial' },
      { target: 'ref', value: 1, type: 'trait' },
      { target: 'skill', skill: 'Perception', value: 2, type: 'competence' },
      { target: 'skill', skill: 'Stealth', value: 2, type: 'competence' },
      { target: 'speed', value: 10, type: 'enhancement' },
    ]);

    // Separate tab-level PRExxx immediately following a BONUS or gating an equipment record skips the bonus.
    assert.deepEqual(parseStaticBonuses(['BONUS:SAVE|ALL|2|TYPE=Resistance', 'PRERACE:1,Dwarf'], 'equipment', ['Magic', 'Wondrous']), []);
    assert.deepEqual(parseStaticBonuses(['BONUS:COMBAT|INITIATIVE|2', 'PREFEAT:1,Alertness'], 'feat', ['General']), []);

    // Armor items skip Armor/Shield/Enhancement AC bonuses; Bracers of Armor (Wondrous) keep Armor AC.
    assert.deepEqual(parseStaticBonuses(['BONUS:COMBAT|AC|4|TYPE=Armor', 'BONUS:COMBAT|AC|1|TYPE=Enhancement'], 'equipment', ['Armor', 'Light']), []);
    assert.deepEqual(parseStaticBonuses(['BONUS:COMBAT|AC|4|TYPE=Armor'], 'equipment', ['Magic', 'Wondrous']), [{ target: 'ac', value: 4, type: 'armor' }]);
    // Weapons skip Enhancement TOHIT/DAMAGE/AC.
    assert.deepEqual(parseStaticBonuses(['BONUS:COMBAT|TOHIT|1|TYPE=Enhancement', 'BONUS:COMBAT|DAMAGE|1|TYPE=Enhancement'], 'equipment', ['Weapon', 'Martial']), []);
  });
});

describe('[Epic 13.3] Engine integration, AC/CMD routing & deduplication', () => {
  test('Amulet of Natural Armor +2 vs Barkskin +3, Ring of Protection, Bracers of Armor, and equip/unequip toggle', () => {
    const c = makePcgCharacter(casterPcg({ classes: ['CLASS:Fighter|LEVEL:4|SKILLPOOL:0'], stats: { STR: 14, DEX: 14, CON: 14 } }));
    c.sheet.misc.natural = 1; // innate natural armor +1 (type: natural)
    const base = computeCharacterStats(c);

    const amuletRec: EquipmentRecord = {
      kind: 'equipment',
      key: 'Amulet of Natural Armor +2',
      name: 'Amulet of Natural Armor +2',
      source: { campaign: 'Core Rulebook', long: 'Core Rulebook', short: 'CR', page: 'p.500' },
      desc: '',
      types: ['Magic', 'Wondrous'],
      cost: 8000,
      weight: 0,
      baseItem: null,
      damage: null,
      critRange: null,
      critMult: null,
      range: null,
      wield: null,
      acBonus: null,
      maxDex: null,
      acp: null,
      asf: null,
      slot: 'neck',
      cl: 5,
      aura: null,
      eqmods: [],
      spellEffect: null,
      bonuses: [{ target: 'ac', value: 2, type: 'enhancement' }],
    };
    const ringRec: EquipmentRecord = { ...amuletRec, key: 'Ring of Protection +2', name: 'Ring of Protection +2', slot: 'ring', bonuses: [{ target: 'ac', value: 2, type: 'deflection' }] };
    const cloakRec: EquipmentRecord = { ...amuletRec, key: 'Cloak of Resistance +2', name: 'Cloak of Resistance +2', slot: 'shoulders', bonuses: [{ target: 'saves', value: 2, type: 'resistance' }] };
    const beltRec: EquipmentRecord = { ...amuletRec, key: 'Belt of Giant Strength +4', name: 'Belt of Giant Strength +4', slot: 'belt', bonuses: [{ target: 'STR', value: 4, type: 'enhancement' }] };

    const amulet = itemFromRecord(amuletRec, 'am') as Exclude<ReturnType<typeof itemFromRecord>, string>;
    const ring = itemFromRecord(ringRec, 'rg') as Exclude<ReturnType<typeof itemFromRecord>, string>;
    const cloak = itemFromRecord(cloakRec, 'ck') as Exclude<ReturnType<typeof itemFromRecord>, string>;
    const belt = itemFromRecord(beltRec, 'bt') as Exclude<ReturnType<typeof itemFromRecord>, string>;
    c.inventory.items.push(amulet, ring, cloak, belt);

    // Initially carried (unequipped): zero stat changes.
    c.inventory.loadouts[0]!.slots = { am: 'carried', rg: 'carried', ck: 'carried', bt: 'carried' };
    assert.equal(computeCharacterStats(c).ac.normal.total, base.ac.normal.total, 'carried items grant no AC');
    assert.equal(computeCharacterStats(c).saves.fort.total, base.saves.fort.total, 'carried cloak grants no saves');

    // Equip Amulet +2 only: stacks with sheet natural +1, stays OFF touch AC and CMD.
    c.inventory.loadouts[0]!.slots = { am: 'neck', rg: 'carried', ck: 'carried', bt: 'carried' };
    let s = computeCharacterStats(c);
    assert.equal(s.ac.normal.total, base.ac.normal.total + 2);
    assert.equal(s.ac.flatFooted.total, base.ac.flatFooted.total + 2);
    assert.equal(s.ac.touch.total, base.ac.touch.total, 'Amulet of Natural Armor stays off touch AC');
    assert.equal(s.cmd.total, base.cmd.total, 'Amulet of Natural Armor stays off CMD');

    // Add Barkskin +3 (enhancement): shares enhancement type with Amulet +2 -> max(2, 3) = +3, touch AC still +0!
    c.runtime.buffs = [presetBuff(c, lookupPreset('barkskin')!, '+3', NO_MOD, 'b1')];
    s = computeCharacterStats(c);
    assert.equal(s.ac.normal.total, base.ac.normal.total + 3, 'Amulet +2 and Barkskin +3 take highest (+3)');
    assert.equal(s.ac.touch.total, base.ac.touch.total, 'Barkskin + Amulet stay off touch AC');
    assert.equal(s.cmd.total, base.cmd.total, 'Barkskin + Amulet stay off CMD');

    // Equip Ring of Protection +2, Cloak +2, Belt +4 Str:
    c.runtime.buffs = [];
    c.inventory.loadouts[0]!.slots = { am: 'neck', rg: 'ring', ck: 'shoulders', bt: 'belt' };
    s = computeCharacterStats(c);
    assert.equal(s.ac.normal.total, base.ac.normal.total + 2 + 2);
    assert.equal(s.ac.touch.total, base.ac.touch.total + 2, 'Ring deflection applies to touch AC');
    assert.equal(s.cmd.total, base.cmd.total + 2 + 2, 'Ring deflection (+2) + Belt Str mod (+2) raise CMD');
    assert.equal(s.saves.fort.total, base.saves.fort.total + 2);
    assert.equal(s.saves.ref.total, base.saves.ref.total + 2);
    assert.equal(s.saves.will.total, base.saves.will.total + 2);
    assert.equal(s.abilities.STR.score, base.abilities.STR.score + 4);

    // applyRecordToItem strips armor AC bonus from armor records so Chain Shirt never double-counts.
    const armorItem = makeItem({ id: 'cs', name: 'Chain Shirt' });
    const armorRec: EquipmentRecord = { ...amuletRec, key: 'Chain Shirt', name: 'Chain Shirt', types: ['Armor', 'Light'], acBonus: 4, maxDex: 4, acp: -2, asf: 20, bonuses: [{ target: 'ac', value: 4, type: 'armor' }] };
    assert.deepEqual(applyRecordToItem(armorItem, armorRec).bonuses, []);

    // +1 Chain Shirt (+5 armor) + Bracers of Armor +4 (armor) + Amulet of Natural Armor +2 (enhancement):
    // armor enhancement is baked into armor (+5 beats Bracers +4) and stacks with Amulet +2 enhancement to natural armor!
    const bracersRec: EquipmentRecord = { ...amuletRec, key: 'Bracers of Armor +4', name: 'Bracers of Armor +4', slot: 'wrists', bonuses: [{ target: 'ac', value: 4, type: 'armor' }] };
    const bracers = itemFromRecord(bracersRec, 'br') as Exclude<ReturnType<typeof itemFromRecord>, string>;
    const plus1Shirt = makeItem({ id: 'p1cs', name: '+1 Chain Shirt', armor: { kind: 'armor', category: 'light', bonus: 4, enhancement: 1, maxDex: 4, acp: -1, asf: 20 } });
    c.inventory.items.push(bracers, plus1Shirt);
    c.inventory.loadouts[0]!.slots = { am: 'neck', br: 'wrists', p1cs: 'armor' };
    const layered = computeCharacterStats(c);
    assert.equal(layered.ac.normal.total, base.ac.normal.total + 5 + 2, '+1 Chain Shirt (+5 armor beats Bracers +4) stacks with Amulet (+2 enhancement)');
    assert.equal(layered.ac.touch.total, base.ac.touch.total, 'armor, bracers and amulet all stay off touch AC');
  });

  test('buildCharacterRulesData powers non-Core classes/races, traits & spell schools without double-counting Core feats or racial abilities', () => {
    const { store, cleanup } = makeTempPack({
      'core.pcc': [
        'CAMPAIGN:Core Rulebook',
        'KEY:Core Rulebook',
        'SOURCELONG:Core Rulebook',
        'SOURCESHORT:CR',
        'PUBNAMELONG:Paizo Inc.',
        'BOOKTYPE:Core Rules',
        'CLASS:classes.lst',
        'RACE:races.lst',
        'ABILITY:abilities.lst',
        'SPELL:spells.lst',
      ].join('\n'),
      'classes.lst': [
        'CLASS:Arcane Trickster\tHD:6\tTYPE:PC.Prestige\tBONUS:COMBAT|BASEAB|classlevel("APPLIEDAS=NONEPIC")/2\tBONUS:SAVE|BASE.Reflex,BASE.Will|(classlevel("APPLIEDAS=NONEPIC")+1)/2',
        'CLASS:Arcane Trickster\tSTARTSKILLPTS:4\tCSKILL:Disable Device|Stealth',
      ].join('\n'),
      'races.lst': 'Gathlain\tFACT:BaseSize|S\tMOVE:Walk,30\tTYPE:Base.PC\tBONUS:STAT|DEX,CHA|2|TYPE=Racial\tBONUS:STAT|CON|-2|TYPE=Racial\tBONUS:SKILL|Fly|2|TYPE=Racial',
      'abilities.lst': [
        'Iron Will\tCATEGORY:FEAT\tTYPE:General\tBONUS:SAVE|Will|2',
        'Reactionary\tKEY:Trait ~ Reactionary\tCATEGORY:Special Ability\tTYPE:Trait\tBONUS:COMBAT|INITIATIVE|2|TYPE=Trait',
        'Deft Dodger\tKEY:Trait ~ Deft Dodger\tCATEGORY:Special Ability\tTYPE:Trait\tBONUS:SAVE|Reflex|1|TYPE=Trait',
        'Suspicious\tKEY:Trait ~ Suspicious\tCATEGORY:Special Ability\tTYPE:Trait\tBONUS:SKILL|Sense Motive|1|TYPE=Trait',
        '+2 Dexterity, +2 Charisma, -2 Constitution\tKEY:Gathlain ~ Ability Scores\tCATEGORY:Special Ability\tTYPE:RacialTraits.Gathlain Racial Default.Racial Ability Scores\tBONUS:STAT|DEX,CHA|2|TYPE=Racial\tBONUS:STAT|CON|-2|TYPE=Racial',
      ].join('\n'),
      'spells.lst': 'Boneshaker\tSCHOOL:Necromancy\tCLASSES:Cleric=2|Wizard=2\tSAVEINFO:Fortitude half\tSPELLRES:yes',
    });
    try {
      const c: Character = makePcgCharacter(
        casterPcg({
          classes: ['CLASS:Wizard|LEVEL:3|SKILLPOOL:0', 'CLASS:Arcane Trickster|LEVEL:2|SKILLPOOL:0'],
          stats: { INT: 18, DEX: 14, CON: 12, WIS: 10 },
          spells: ['SPELLNAME:Boneshaker|SCHOOL:Necromancy|DESCRIPTOR:|CLASS:Wizard|LEVEL:2|SPELLBOOK:Prepared|TIMES:1'],
          extra: [
            'ABILITY:FEAT|TYPE:NORMAL|CATEGORY:FEAT|KEY:Iron Will',
            'ABILITY:Special Ability|TYPE:NORMAL|CATEGORY:Special Ability|KEY:Trait ~ Reactionary',
            'ABILITY:Special Ability|TYPE:NORMAL|CATEGORY:Special Ability|KEY:Trait ~ Deft Dodger',
            'ABILITY:Special Ability|TYPE:NORMAL|CATEGORY:Special Ability|KEY:Trait ~ Suspicious',
            'ABILITY:Special Ability|TYPE:NORMAL|CATEGORY:Special Ability|KEY:Gathlain ~ Ability Scores',
            'ABILITY:FEAT|TYPE:NORMAL|CATEGORY:FEAT|KEY:Spell Focus|APPLIEDTO:Necromancy',
            'SKILL:Disable Device|OUTPUTORDER:1|CLASSBOUGHT:[CLASS:Arcane Trickster|RANKS:1.0|COST:1|CLASSSKILL:N]',
          ],
        }).replace('RACE:Human', 'RACE:Gathlain'),
      );

      c.rulesData = buildCharacterRulesData(c.build, store as RulesProvider);
      // Core feats & racial default ability scores must NOT appear in rulesData.bonuses.
      assert.equal(c.rulesData.bonuses.some((b) => /iron will|reactionary|ability scores/i.test(b.source)), false);
      assert.ok(c.rulesData.bonuses.some((b) => b.source === 'Deft Dodger' && b.target === 'ref' && b.value === 1));
      assert.ok(c.rulesData.bonuses.some((b) => b.source === 'Suspicious' && b.target === 'skill' && b.skill === 'Sense Motive'));

      const stats = computeCharacterStats(c);
      assert.equal(stats.size, 'Small', 'Gathlain size from rulesData.race');
      assert.equal(stats.abilities.DEX.score, 16, '14 base + 2 racial (not +4 double-counted)');
      assert.equal(stats.abilities.CON.score, 10, '12 base - 2 racial');
      assert.equal(stats.bab.total, 1 + 1, 'Wizard 3 (1) + Arcane Trickster 2 (1) = 2');
      // Reflex: Wizard 3 (1) + AT 2 prestige good ((2+1)/2=1) + Dex (+3) + Deft Dodger (+1 trait) = 6
      assert.equal(stats.saves.ref.total, 1 + 1 + 3 + 1);
      // Will: Wizard 3 (3) + AT 2 (1) + Wis (0) + Iron Will (+2, NOT +4) = 6
      assert.equal(stats.saves.will.total, 3 + 1 + 0 + 2);
      // Initiative: Dex (+3) + Reactionary (+2, NOT +4) = 5
      assert.equal(stats.initiative.total, 3 + 2);

      const skills = computeSkills(c, stats);
      // Explicit CLASSSKILL:N in .pcg is preserved (e.g. archetype replacement), while un-listed class skills inherit from rulesData.classes!
      const dd = skills.rows.find((r) => r.name === 'Disable Device')!;
      assert.equal(dd.classSkill, false, 'explicit .pcg CLASSSKILL:N is respected');
      const stealth = skills.rows.find((r) => r.name === 'Stealth')!;
      assert.equal(stealth.classSkill, true, 'un-listed Stealth inherits classSkill from Arcane Trickster rulesData');
      // Suspicious adds +1 trait to Sense Motive.
      const sm = skills.rows.find((r) => r.name === 'Sense Motive')!;
      assert.equal(sm.total.parts.find((p) => p.source === 'Suspicious')?.value, 1);
      // Fly gets +2 racial from Gathlain + +2 Small size + +3 Dex = 7.
      const fly = skills.rows.find((r) => r.name === 'Fly')!;
      assert.equal(fly.total.parts.find((p) => p.type === 'racial')?.value, 2);

      // Client-side spellDc (no RulesProvider passed) resolves Boneshaker school from rulesData.spellSchools!
      const wiz = characterSpellcasting(c, stats)[0]!;
      assert.equal(spellDc(c, wiz, 'Boneshaker', 2), 10 + 2 + 4 + 1, 'Spell Focus Necromancy raises Boneshaker DC to 17');
    } finally {
      cleanup();
    }
  });
});
