import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, test } from 'node:test';
import {
  characterSpellcasting,
  computeCharacterStats,
  detectGear,
  lookupCasterClass,
  lookupWeapon,
  makeItem,
  raceDataFromSnapshot,
  weaponKey,
} from '@vtt/shared';
import { buildRulesPack } from '../../src/rules/buildPack';
import { RulesPackStore } from '../../src/rules/packStore';
import { makePcgCharacter, SAMPLE_PCG } from '../helpers/harness';

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe('[Rules audit] weapon detection matches whole weapon names only', () => {
  test("distinct weapons no longer borrow a shorter weapon's stats (values from PCGen data)", () => {
    // Each of these used to match a contained word: Spear, Pistol, Whip, Sling, Musket, Sickle...
    assert.equal(lookupWeapon('Chain Spear')?.damage, '1d6');
    assert.equal(lookupWeapon('Coat Pistol')?.damage, '1d4');
    assert.equal(lookupWeapon('Nine-Section Whip')?.damage, '1d8');
    assert.equal(lookupWeapon('Halfling Sling Staff')?.damage, '1d6');
    assert.equal(lookupWeapon('Axe Musket')?.damage, '1d8');
    assert.equal(lookupWeapon('Scorpion Whip')?.damage, '1d4');
    assert.equal(lookupWeapon('Kusarigama (Sickle and Chain)'), undefined, 'unknown weapon: no guessed stats');
    assert.notEqual(weaponKey('Chain Spear'), 'spear', 'Weapon Focus (Spear) must not apply to a chain spear');
  });

  test('magic, masterwork, material and PCGen name forms still resolve', () => {
    assert.equal(lookupWeapon('+1 Flaming Longsword')?.damage, '1d8');
    assert.equal(lookupWeapon('Longsword +2 (Keen)')?.critRange, 19);
    assert.equal(lookupWeapon('Masterwork Cold Iron Dagger')?.damage, '1d4');
    assert.equal(lookupWeapon('Longsword, Masterwork')?.damage, '1d8');
    assert.equal(lookupWeapon('Longhammer, Dwarven')?.damage, '2d6');
    assert.equal(lookupWeapon('Sword (Short)')?.damage, '1d6');
    assert.equal(lookupWeapon('Wooden Stake')?.damage, '1d4');
    assert.equal(lookupWeapon('Light Flail')?.damage, '1d8');
    assert.equal(lookupWeapon('Wand of Acid Arrow'), undefined);
    assert.equal(lookupWeapon('Falcata')?.critMult, 3);
    assert.equal(lookupWeapon('Rifle')?.strDamage, 'none', 'firearms add no Strength');
  });

  test('adamantine, mithral, darkwood and dragonhide weapons are masterwork (+1 attack)', () => {
    assert.equal(detectGear('Adamantine Battleaxe').weapon?.masterwork, true);
    assert.equal(detectGear('Mithral Dagger').weapon?.masterwork, true);
    assert.equal(detectGear('Cold Iron Battleaxe').weapon?.masterwork, false, 'cold iron is not automatically masterwork');
  });
});

describe('[Rules audit] armor names and special materials', () => {
  test('PCGen "Base (Variant)" / "Base, Variant" armor names resolve to the specific armor', () => {
    const leather = detectGear('Lamellar (Leather)').armor!;
    assert.deepEqual([leather.bonus, leather.maxDex, leather.acp, leather.asf], [4, 3, -2, 20], 'not plain Leather (+2)');
    assert.equal(detectGear('Lamellar (Steel)').armor?.category, 'medium');
    assert.equal(detectGear('Quickdraw Shield, Light Wooden').armor?.acp, -2);
    assert.equal(detectGear('Madu').armor?.asf, 5);
    assert.equal(detectGear('Leather Boots').armor, null, 'still not armor');
  });

  test('mithral: one category lighter, +2 max Dex, 3 less ACP total (CRB p.154, includes masterwork), 10% less ASF', () => {
    const shirt = detectGear('Mithral Shirt').armor!;
    assert.deepEqual([shirt.category, shirt.bonus, shirt.maxDex, shirt.acp, shirt.asf], ['light', 4, 6, 0, 10]);
    const elven = detectGear('Elven Chain').armor!;
    assert.deepEqual([elven.category, elven.bonus, elven.maxDex, elven.acp, elven.asf], ['light', 6, 4, -2, 20]);
    const bp = detectGear('Mithral Breastplate').armor!;
    assert.deepEqual([bp.category, bp.maxDex, bp.acp, bp.asf], ['light', 5, -1, 15]);
    const fp = detectGear('+1 Mithral Full Plate').armor!;
    assert.deepEqual([fp.category, fp.enhancement, fp.maxDex, fp.acp, fp.asf], ['medium', 1, 3, -3, 25]);
    assert.equal(detectGear('Chain Shirt', null, 'EQMOD=Material ~ Mithril ~ Armor / Light').armor?.maxDex, 6, 'PCGen spells it Mithril in EQMODs');
    assert.equal(detectGear('Mithral Heavy Shield').armor?.acp, 0);
    assert.equal(detectGear('Dwarven Plate').armor?.category, 'heavy', 'adamantine: no category change');
    assert.equal(detectGear('Dwarven Plate').armor?.acp, -5, 'adamantine full plate is masterwork (-6 + 1 = -5)');
  });

  test('darkwood shields: 2 less ACP total; a mithral breastplate no longer slows the wearer', () => {
    assert.equal(detectGear('Darkwood Shield').armor?.acp, 0);
    assert.equal(detectGear('Darkwood Buckler').armor?.acp, 0);
    const c = makePcgCharacter();
    const plate = makeItem({ id: 'bp', name: 'Mithral Breastplate', ...detectGear('Mithral Breastplate') });
    c.inventory.items.push(plate);
    c.inventory.loadouts[0]!.slots.bp = 'armor';
    const s = computeCharacterStats(c);
    assert.equal(s.armor.heavyArmor, false);
    assert.equal(s.speed.total, 30);
  });
});

describe('[Rules audit] casters and race snapshots', () => {
  test('Medium casts like a bloodrager (1st-4th levels, Cha) with knacks at will', () => {
    const def = lookupCasterClass('Medium')!;
    assert.deepEqual([def.model, def.stat, def.tradition, def.cantrips], ['spontaneous', 'CHA', 'psychic', true]);
    assert.deepEqual(def.perDay[3], [null, 1], 'level 4: one 1st-level spell');
    assert.deepEqual(def.perDay[19], [null, 4, 4, 3, 2]);
    const c = makePcgCharacter(SAMPLE_PCG.replace('CLASS:Wizard|LEVEL:1', 'CLASS:Medium|LEVEL:1').replace('CLASSABILITIESLEVEL:Wizard=1', 'CLASSABILITIESLEVEL:Medium=1'));
    const medium = characterSpellcasting(c).find((i) => i.className === 'Medium')!;
    assert.equal(medium.levels.find((l) => l.level === 0)?.atWill, true);
  });

  test('a 0 ft race speed in a snapshot falls back by size instead of freezing the character', () => {
    const base = { abilityMods: {}, anyPlusTwo: false, steady: false, darkvision: 0, lowLight: false, skillBonuses: {} };
    assert.equal(raceDataFromSnapshot({ ...base, size: 'Small', speed: 0 })!.speed, 20);
    assert.equal(raceDataFromSnapshot({ ...base, size: 'Medium', speed: 0 })!.speed, 30);
    assert.equal(raceDataFromSnapshot({ ...base, size: 'Small', speed: 30 })!.speed, 30);
  });
});

describe('[Rules audit] rules pack builder reads PCGen races and classes correctly', () => {
  function buildMiniPack(): RulesPackStore {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vtt-rules-audit-'));
    tmpDirs.push(dir);
    const inDir = path.join(dir, 'in');
    const outDir = path.join(dir, 'out');
    fs.mkdirSync(inDir, { recursive: true });
    fs.writeFileSync(
      path.join(inDir, 'core.pcc'),
      ['CAMPAIGN:Core Rulebook', 'KEY:Core Rulebook', 'SOURCELONG:Core Rulebook', 'SOURCESHORT:CR', 'PUBNAMELONG:Paizo Inc.', 'BOOKTYPE:Core Rules', 'RACE:races.lst', 'CLASS:classes.lst', 'ABILITY:abilities.lst'].join('\n'),
    );
    fs.writeFileSync(
      path.join(inDir, 'races.lst'),
      [
        // PCGen 6 Core races set speed 0 on the race and the real speed on a default racial trait.
        'Goblin\tFACT:BaseSize|S\tMOVE:Walk,0\tTYPE:Base.PC\tSOURCEPAGE:p.1',
        'Strix\tFACT:BaseSize|M\tMOVE:Walk,30\tTYPE:Base.PC\tSOURCEPAGE:p.2',
        'Elf\tFACT:BaseSize|M\tMOVE:Walk,30\tTYPE:Base.PC\tSOURCEPAGE:p.3',
      ].join('\n'),
    );
    fs.writeFileSync(
      path.join(inDir, 'abilities.lst'),
      [
        'Normal Speed\tKEY:Goblin ~ Speed\tCATEGORY:Special Ability\tTYPE:RacialTraits.Goblin Racial Trait.Goblin Racial Default\tMOVE:Walk,30\tDESC:Goblins are fast.',
        'Darkvision\tKEY:Strix ~ Darkvision\tCATEGORY:Special Ability\tTYPE:RacialTraits.Strix Racial Trait.Strix Racial Default\tVISION:Darkvision (60)\tDESC:See in the dark.',
        'Keen Senses\tKEY:Elf ~ Keen Senses\tCATEGORY:Special Ability\tTYPE:RacialTraits.Elf Racial Trait.Elf Racial Default\tBONUS:SKILL|Perception|KeenSensesBonus|TYPE=Racial\tBONUS:VAR|KeenSensesBonus|2',
        // Not a racial default, and level-scaled: its variable must stay unresolved.
        'Cat Focus\tKEY:Animal Focus ~ Cat\tCATEGORY:Special Ability\tTYPE:HunterAnimalFocusAbility\tBONUS:SKILL|Acrobatics|CatBonus|TYPE=Competence\tBONUS:VAR|CatBonus|2\tBONUS:VAR|CatBonus|2|PREVARGTEQ:FocusLVL,8',
        'Standard Monk\tKEY:Monk ~ Standard Class\tCATEGORY:Class\tTYPE:Internal\tBONUS:COMBAT|BASEAB|classlevel("Monk","APPLIEDAS=NONEPIC")*3/4|TYPE=Base.REPLACE\tBONUS:SAVE|BASE.Fortitude,BASE.Reflex,BASE.Will|classlevel("Monk","APPLIEDAS=NONEPIC")/2+2',
      ].join('\n'),
    );
    fs.writeFileSync(
      path.join(inDir, 'classes.lst'),
      [
        // PCGen's samurai: BONUS:SAVE says only Fortitude is good; its fractional-save vars wrongly list Reflex too.
        'CLASS:Samurai\tHD:10\tTYPE:Base.PC\tBONUS:COMBAT|BASEAB|classlevel("APPLIEDAS=NONEPIC")|TYPE=Base.REPLACE\tBONUS:SAVE|BASE.Reflex,BASE.Will|classlevel("APPLIEDAS=NONEPIC")/3\tBONUS:SAVE|BASE.Fortitude|classlevel("APPLIEDAS=NONEPIC")/2+2\tBONUS:VAR|ClassSaveGood_Fortitude|classlevel("APPLIEDAS=NONEPIC")|PREVAREQ:UseFractionalSave,1\tBONUS:VAR|ClassSaveGood_Reflex|classlevel("APPLIEDAS=NONEPIC")|PREVAREQ:UseFractionalSave,1',
        'CLASS:Monk\tHD:8\tTYPE:Base.PC',
      ].join('\n'),
    );
    buildRulesPack(inDir, outDir);
    return new RulesPackStore(outDir);
  }

  test('race speed and vision come from default racial traits; Keen Senses resolves its variable', () => {
    const pack = buildMiniPack();
    assert.equal(pack.byName('race', 'Goblin')?.speed, 30);
    assert.equal(pack.byName('race', 'Strix')?.darkvision, 60);
    assert.deepEqual(pack.byName('race', 'Elf')?.skillBonuses, { Perception: 2 });
    assert.deepEqual(pack.get('ability', 'Animal Focus ~ Cat')?.bonuses ?? [], [], 'level-scaled variable left alone');
  });

  test('class saves prefer BONUS:SAVE; Monk gets its chassis from "Monk ~ Standard Class"', () => {
    const pack = buildMiniPack();
    assert.deepEqual(pack.byName('class', 'Samurai')?.goodSaves, ['fort']);
    const monk = pack.byName('class', 'Monk')!;
    assert.equal(monk.bab, 'threeQuarter');
    assert.deepEqual([...monk.goodSaves].sort(), ['fort', 'ref', 'will']);
  });
});
