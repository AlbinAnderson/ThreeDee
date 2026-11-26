import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import {
  decodePcgenEntities,
  parseCustomizationData,
  parseLine,
  parsePcg,
  parsePcgToJson,
  PcgenCharacterSchema,
  splitBracketAware,
} from '@vtt/shared';

const SAMPLE_PF1E_PCG = `PCGVERSION:2.0

# System Information
CAMPAIGN:Paizo - Pathfinder Roleplaying Game Core Rulebook|CAMPAIGN:Paizo - Pathfinder Roleplaying Game Advanced Player's Guide
VERSION:6.08.00 RC8
ROLLMETHOD:1|EXPRESSION:roll(4,6,[2,3,4])
PURCHASEPOINTS:Y|TYPE:Standard Fantasy
CHARACTERTYPE:PC
PREVIEWSHEET:Standard.htm
POOLPOINTS:0
POOLPOINTSAVAIL:-1
GAMEMODE:Pathfinder
TABLABEL:0
AUTOSPELLS:Y
USEHIGHERKNOWN:N
USEHIGHERPREPPED:N
LOADCOMPANIONS:N
USETEMPMODS:Y
AUTOSORTGEAR:Y
SKILLSOUTPUTORDER:0
SKILLFILTER:2
IGNORECOST:N
ALLOWDEBT:N
AUTORESIZEGEAR:Y

# Character Bio
CHARACTERNAME:Valeros &amp; Friends
TABNAME:Valeros
PLAYERNAME:Alex
HEIGHT:72
WEIGHT:190
AGE:24
AGESET:1
GENDER:Male
HANDED:Right
SKINCOLOR:Tan
EYECOLOR:Brown
HAIRCOLOR:Brown
HAIRSTYLE:Short
LOCATION:Sandpoint
CITY:Sandpoint
BIRTHDAY:14 Desnus
BIRTHPLACE:Andoran
PERSONALITYTRAIT1:Loyal&colon; never leaves an ally
PERSONALITYTRAIT2:Enjoys a good ale
SPEECHPATTERN:Direct
PHOBIAS:None
INTERESTS:Swordplay|Taverns
CATCHPHRASE:Steel &amp; Courage&pipe;Always!
PORTRAIT:/portraits/valeros.png
PORTRAITTHUMBNAILRECT:0,0,100,100
CHARACTERDESC:Broad-shouldered fighter&nl;Carries two blades.
CHARACTERBIO:Born in Andoran&nl;Trained in the militia.
SUPPRESS_BIO_FIELDS:PHOBIAS|INTERESTS

# Character Attributes
STAT:STR|SCORE:16
STAT:DEX|SCORE:15
STAT:CON|SCORE:14
STAT:INT|SCORE:10
STAT:WIS|SCORE:12
STAT:CHA|SCORE:10
ALIGN:NG
RACE:Human
FAVOREDCLASS:Fighter
REGION:Varisia
TEMPLATE:Mythic Tier 1|TEMPLATE:Cursed
DEITY:Cayden Cailean|DEITYDOMAINS:[DOMAIN:Chaos|DOMAIN:Good]|ALIGNALLOW:CG,NG,CN|DESC:The Accidental God|SYMBOL:Tankard|DEITYFAVWEAP:[WEAPON:Rapier]|DEITYALIGN:CG
DOMAIN:Good|SOURCE:[TYPE:CLASS|NAME:Cleric]

# Character Class(es)
CLASS:Fighter|LEVEL:2|SKILLPOOL:0|SPELLBASE:None|CANCASTPERDAY:0
CLASS:Wizard|LEVEL:1|SUBCLASS:Evoker|SKILLPOOL:0|SPELLBASE:INT|CANCASTPERDAY:3,1|SPECIALTY:Evocation|PROHIBITED:Necromancy,Enchantment
CLASSABILITIESLEVEL:Fighter=1|HITPOINTS:10|SKILLSGAINED:3|SKILLSREMAINING:0
CLASSABILITIESLEVEL:Fighter=2|HITPOINTS:7|SKILLPOINTSGAINED:3|SKILLPOINTSREMAINING:0|STAT:STR=1|CUSTOMTAG:extraVal
CLASSABILITIESLEVEL:Wizard=1|HITPOINTS:6|SKILLSGAINED:2|SKILLSREMAINING:0

# Character Experience
EXPERIENCE:2300
EXPERIENCETABLE:Medium
MONEY:42.5

# Character Skills
SKILL:Climb|OUTPUTORDER:6|CLASSBOUGHT:[CLASS:Fighter|RANKS:2.0|COST:1|CLASSSKILL:Y]
SKILL:Perception|OUTPUTORDER:15|CLASSBOUGHT:[CLASS:Fighter|RANKS:1.0|COST:1|CLASSSKILL:N]|CLASSBOUGHT:[CLASS:Wizard|RANKS:1.0|COST:1|CLASSSKILL:N]
SKILL:Knowledge (Arcana)|OUTPUTORDER:12|ASSOCIATEDDATA:Arcana|CLASSBOUGHT:[CLASS:Wizard|RANKS:1.0|COST:1|CLASSSKILL:Y]

# Character Languages
LANGUAGE:Common|LANGUAGE:Varisian
LANGUAGE:Elven
WEAPONPROF:Longsword|WEAPONPROF:Shortbow

# Character Feats & Abilities
USERPOOL:FEAT|POOLPOINTS:0.0
USERPOOL:Trait|POOLPOINTS:0.0
FEAT:Legacy Toughness
VFEAT:Simple Weapon Proficiency
ABILITY:FEAT|TYPE:NORMAL|CATEGORY:FEAT|KEY:Power Attack|TYPE:Combat.General|DESC:Trade accuracy for damage|COST:1.0
ABILITY:FEAT|TYPE:NORMAL|CATEGORY:FEAT|KEY:Weapon Focus|TYPE:Combat.General|APPLIEDTO:Longsword|APPLIEDTO:Shortsword
ABILITY:Special Ability|TYPE:AUTOMATIC|CATEGORY:Special Ability|KEY:Bonus Feat|TYPE:SpecialQuality
ABILITY:Special Ability|TYPE:NORMAL|CATEGORY:Special Ability|KEY:Trait ~ Reactionary|TYPE:Trait.CombatTrait

# Character Equipment
EQUIPNAME:Longsword (Masterwork)|OUTPUTORDER:1|COST:315.0|WT:4.0|QUANTITY:1.0|NOTE:Family heirloom|CUSTOMIZATION:[BASEITEM:Longsword|DATA:KEY=Longsword$NAME=Longsword (Masterwork)$EQMOD=MWORKW$EQMOD=STEEL]
EQUIPNAME:Backpack|OUTPUTORDER:2|COST:2.0|WT:2.0|QUANTITY:1.0
EQUIPNAME:Trail Rations|OUTPUTORDER:3|COST:0.5|WT:1.0|QUANTITY:5.0

# Character Equipment Sets
EQUIPSET:Default Set|ID:0.1|USETEMPMODS:Y
EQUIPSET:Primary Hand|ID:0.1.1|VALUE:Longsword (Masterwork)|QUANTITY:1.0
EQUIPSET:Equipped|ID:0.1.2|VALUE:Backpack|QUANTITY:1.0
EQUIPSET:Backpack|ID:0.1.2.1|VALUE:Trail Rations|QUANTITY:5.0|NOTE:5 days
CALCEQUIPSET:0.1

# Character Spells Information
SPELLBOOK:Known Spells|TYPE:1
SPELLBOOK:Default Spell Book|TYPE:2
SPELLLIST:CLASS:Wizard|LEVEL:1|SPELL:Magic Missile|SPELL:Shield
SPELLNAME:Magic Missile|TIMES:2|CLASS:Wizard|BOOK:Default Spell Book|LEVEL:1|CASTERLEVEL:1|DC:15|METAMAGIC:Still Spell,Silent Spell
SPELLMEM:Wizard|Default Spell Book|0|0|Detect Magic|TIMES:1|CASTERLEVEL:1|DC:14
SPELLMEM:CLASS:Wizard|SPELLBOOK:Default Spell Book|LEVEL:1|SPELL:Shield|TIMES:1

# Character Temporary Bonuses
TEMPBONUS:Power Attack|TEMPBONUSTARGET:PC|TEMPBONUSDESCR:-1 attack, +2 damage|TEMPBONUSEQSET:0.1

# Character Master/Follower
FOLLOWER:Hawk|TYPE:Familiar|HITDICE:1|FILE:hawk.pcg

# Character Notes Tab
NOTE:Session Notes|ID:0|PARENTID:-1|VALUE:Met at the Rusty Dragon.&nl;Fought goblins&colon; won!
NOTE:Goblin Loot|ID:1|PARENTID:0|VALUE:3 rusty dogslicers

# Kits
KIT:1|Starting Gold

# Chronicle & Unknown
CHRONICLEENTRY:CAMPAIGN:Rise of the Runelords|ADVENTURE:Burnt Offerings
FUTURETAG:SomeValue|SUB:123
`;

describe('pcgen tokenizer', () => {
  test('decodes PCGen entities in a single pass without double-unescaping', () => {
    assert.equal(
      decodePcgenEntities('A&colon;B&pipe;C&nl;D&cr;E&lbracket;F&rbracket;&amp;pipe;'),
      'A:B|C\nD\rE[F]&pipe;',
    );
  });

  test('splits pipes outside brackets while keeping nested bracket blocks intact', () => {
    const parts = splitBracketAware(
      'SKILL:Climb|CLASSBOUGHT:[CLASS:Fighter|RANKS:2.0|COST:1]|SYNERGY:None',
      '|',
    );
    assert.deepEqual(parts, [
      'SKILL:Climb',
      'CLASSBOUGHT:[CLASS:Fighter|RANKS:2.0|COST:1]',
      'SYNERGY:None',
    ]);
  });

  test('parses bracketed subTokens recursively and leaves non-bracketed expressions intact', () => {
    const rollLine = parseLine('ROLLMETHOD:1|EXPRESSION:roll(4,6,[2,3,4])', 1)!;
    assert.equal(rollLine.tokens[1]?.tag, 'EXPRESSION');
    assert.equal(rollLine.tokens[1]?.value, 'roll(4,6,[2,3,4])');
    assert.equal(rollLine.tokens[1]?.subTokens, undefined);

    const skillLine = parseLine('SKILL:Climb|CLASSBOUGHT:[CLASS:Fighter|RANKS:2.0]', 2)!;
    assert.equal(skillLine.tokens[1]?.tag, 'CLASSBOUGHT');
    assert.deepEqual(skillLine.tokens[1]?.subTokens, [
      { tag: 'CLASS', value: 'Fighter' },
      { tag: 'RANKS', value: '2.0' },
    ]);
  });

  test('parses equipment customization $-delimited KEY=VAL data', () => {
    assert.deepEqual(
      parseCustomizationData('KEY=Longsword$NAME=Masterwork Longsword$EQMOD=MWORKW$EQMOD=STEEL'),
      {
        KEY: ['Longsword'],
        NAME: ['Masterwork Longsword'],
        EQMOD: ['MWORKW', 'STEEL'],
      },
    );
  });
});

describe('parsePcg', () => {
  test('parses a complete PF1e .pcg file into structured, Zod-validated JSON', () => {
    const parsed = parsePcg(SAMPLE_PF1E_PCG);

    // Round-trip through JSON and Zod schema
    const roundTripped = PcgenCharacterSchema.parse(JSON.parse(parsePcgToJson(SAMPLE_PF1E_PCG)));
    assert.deepEqual(roundTripped, parsed);

    // System
    assert.equal(parsed.format, 'pcgen-pcg');
    assert.equal(parsed.schemaVersion, 1);
    assert.equal(parsed.system.pcgVersion, '2.0');
    assert.equal(parsed.system.pcgenVersion, '6.08.00 RC8');
    assert.equal(parsed.system.gameMode, 'Pathfinder');
    assert.equal(parsed.system.characterType, 'PC');
    assert.deepEqual(parsed.system.campaigns, [
      'Paizo - Pathfinder Roleplaying Game Core Rulebook',
      "Paizo - Pathfinder Roleplaying Game Advanced Player's Guide",
    ]);
    assert.deepEqual(parsed.system.rollMethod, {
      method: 1,
      rawMethod: '1',
      expression: 'roll(4,6,[2,3,4])',
    });
    assert.deepEqual(parsed.system.purchasePoints, {
      enabled: true,
      type: 'Standard Fantasy',
    });
    assert.equal(parsed.system.settings.AUTOSPELLS, true);
    assert.equal(parsed.system.settings.ALLOWDEBT, false);
    assert.equal(parsed.system.settings.SKILLFILTER, 2);

    // Bio & decoded entities
    assert.equal(parsed.bio.name, 'Valeros & Friends');
    assert.equal(parsed.bio.playerName, 'Alex');
    assert.equal(parsed.bio.height, 72);
    assert.equal(parsed.bio.weight, 190);
    assert.equal(parsed.bio.age, 24);
    assert.equal(parsed.bio.personalityTrait1, 'Loyal: never leaves an ally');
    assert.equal(parsed.bio.catchPhrase, 'Steel & Courage|Always!');
    assert.equal(parsed.bio.description, 'Broad-shouldered fighter\nCarries two blades.');
    assert.deepEqual(parsed.bio.suppressBioFields, ['PHOBIAS', 'INTERESTS']);

    // Attributes
    assert.deepEqual(parsed.attributes.stats, {
      STR: 16,
      DEX: 15,
      CON: 14,
      INT: 10,
      WIS: 12,
      CHA: 10,
    });
    assert.equal(parsed.attributes.alignment, 'NG');
    assert.equal(parsed.attributes.race, 'Human');
    assert.deepEqual(parsed.attributes.favoredClasses, ['Fighter']);
    assert.equal(parsed.attributes.region, 'Varisia');
    assert.deepEqual(parsed.attributes.templates, ['Mythic Tier 1', 'Cursed']);
    assert.deepEqual(parsed.attributes.languages, ['Common', 'Varisian', 'Elven']);
    assert.deepEqual(parsed.attributes.weaponProficiencies, ['Longsword', 'Shortbow']);
    assert.equal(parsed.attributes.deity?.name, 'Cayden Cailean');
    assert.equal(parsed.attributes.deity?.alignment, 'CG');
    assert.deepEqual(parsed.attributes.deity?.domains, ['Chaos', 'Good']);
    assert.deepEqual(parsed.attributes.deity?.favoredWeapons, ['Rapier']);
    assert.equal(parsed.attributes.domains.length, 1);
    assert.deepEqual(parsed.attributes.domains[0]?.source, { TYPE: 'CLASS', NAME: 'Cleric' });

    // Experience & money
    assert.deepEqual(parsed.experience, { xp: 2300, table: 'Medium' });
    assert.deepEqual(parsed.money, { amount: 42.5, raw: '42.5' });

    // Classes & class levels
    assert.equal(parsed.classes.length, 2);
    assert.equal(parsed.classes[0]?.name, 'Fighter');
    assert.equal(parsed.classes[0]?.level, 2);
    assert.equal(parsed.classes[1]?.name, 'Wizard');
    assert.equal(parsed.classes[1]?.subClass, 'Evoker');
    assert.equal(parsed.classes[1]?.specialty, 'Evocation');
    assert.deepEqual(parsed.classes[1]?.prohibited, ['Necromancy', 'Enchantment']);

    assert.equal(parsed.classLevels.length, 3);
    assert.equal(parsed.classLevels[0]?.hitPoints, 10);
    assert.equal(parsed.classLevels[1]?.skillsGained, 3);
    assert.deepEqual(parsed.classLevels[1]?.statIncreases, { STR: 1 });
    assert.deepEqual(parsed.classLevels[1]?.extra, [{ tag: 'CUSTOMTAG', value: 'extraVal' }]);

    // Skills
    assert.equal(parsed.skills.length, 3);
    const perception = parsed.skills.find((s) => s.name === 'Perception')!;
    assert.equal(perception.totalRanks, 2);
    assert.equal(perception.classBought.length, 2);
    assert.equal(perception.classBought[0]?.classSkill, false);
    const climb = parsed.skills.find((s) => s.name === 'Climb')!;
    assert.equal(climb.classBought[0]?.classSkill, true);

    // Abilities, legacy feats & pools
    assert.deepEqual(parsed.abilityPools, { FEAT: 0, Trait: 0 });
    assert.deepEqual(parsed.legacyFeats, ['Legacy Toughness']);
    assert.deepEqual(parsed.virtualFeats, ['Simple Weapon Proficiency']);
    assert.equal(parsed.abilities.length, 4);
    const powerAttack = parsed.abilities.find((a) => a.key === 'Power Attack')!;
    assert.equal(powerAttack.category, 'FEAT');
    assert.equal(powerAttack.nature, 'NORMAL');
    assert.deepEqual(powerAttack.types, ['Combat', 'General']);
    assert.equal(powerAttack.cost, 1);

    const weaponFocus = parsed.abilities.find((a) => a.key === 'Weapon Focus')!;
    assert.deepEqual(weaponFocus.appliedTo, ['Longsword', 'Shortsword']);

    // Equipment & hierarchical equipment sets
    assert.equal(parsed.equipment.length, 3);
    const sword = parsed.equipment[0]!;
    assert.equal(sword.cost, 315);
    assert.equal(sword.weight, 4);
    assert.equal(sword.note, 'Family heirloom');
    assert.equal(sword.customization?.baseItem, 'Longsword');
    assert.deepEqual(sword.customization?.data.EQMOD, ['MWORKW', 'STEEL']);

    assert.equal(parsed.activeEquipmentSetId, '0.1');
    assert.equal(parsed.equipmentSets.length, 1);
    const defaultSet = parsed.equipmentSets[0]!;
    assert.equal(defaultSet.name, 'Default Set');
    assert.equal(defaultSet.useTempMods, true);
    assert.equal(defaultSet.items.length, 3);
    assert.equal(defaultSet.items[2]?.itemName, 'Trail Rations');
    assert.equal(defaultSet.items[2]?.parentId, '0.1.2');

    // Spells (SPELLNAME + positional SPELLMEM + keyed SPELLMEM)
    assert.equal(parsed.spells.spellBooks.length, 2);
    assert.equal(parsed.spells.spellLists.length, 1);
    assert.equal(parsed.spells.spellLists[0]?.className, 'Wizard');
    assert.equal(parsed.spells.spellLists[0]?.level, 1);
    assert.deepEqual(parsed.spells.spellLists[0]?.spells, ['Magic Missile', 'Shield']);

    assert.equal(parsed.spells.entries.length, 3);
    assert.equal(parsed.spells.entries[0]?.spellName, 'Magic Missile');
    assert.equal(parsed.spells.entries[0]?.times, 2);
    assert.deepEqual(parsed.spells.entries[0]?.metamagic, ['Still Spell', 'Silent Spell']);
    assert.equal(parsed.spells.entries[1]?.spellName, 'Detect Magic');
    assert.equal(parsed.spells.entries[1]?.className, 'Wizard');
    assert.equal(parsed.spells.entries[1]?.level, 0);
    assert.equal(parsed.spells.entries[2]?.spellName, 'Shield');
    assert.equal(parsed.spells.entries[2]?.book, 'Default Spell Book');
    assert.equal(parsed.spells.entries[2]?.level, 1);

    // Temp bonuses, companions, notes, kits, chronicle, unknownLines
    assert.equal(parsed.tempBonuses.length, 1);
    assert.equal(parsed.tempBonuses[0]?.name, 'Power Attack');
    assert.equal(parsed.tempBonuses[0]?.target, 'PC');

    assert.equal(parsed.companions.followers.length, 1);
    assert.equal(parsed.companions.followers[0]?.name, 'Hawk');
    assert.equal(parsed.companions.followers[0]?.type, 'Familiar');

    assert.equal(parsed.notes.length, 2);
    assert.equal(parsed.notes[0]?.value, 'Met at the Rusty Dragon.\nFought goblins: won!');
    assert.equal(parsed.notes[1]?.parentId, 0);

    assert.equal(parsed.kits.length, 1);
    assert.deepEqual(parsed.kits[0], { count: 1, name: 'Starting Gold', extra: [] });

    assert.equal(parsed.chronicleEntries.length, 1);
    assert.equal(parsed.unknownLines.length, 1);
    assert.equal(parsed.unknownLines[0]?.tag, 'FUTURETAG');
    assert.deepEqual(parsed.warnings, []);
  });

  test('handles UTF-8 BOM, CRLF line endings, and empty/comment-only input', () => {
    const bomCrlf = '\uFEFF# comment\r\nPCGVERSION:2.0\r\nCHARACTERNAME:Merisiel\r\nSTAT:DEX|SCORE:18\r\n';
    const parsed = parsePcg(bomCrlf);
    assert.equal(parsed.system.pcgVersion, '2.0');
    assert.equal(parsed.bio.name, 'Merisiel');
    assert.deepEqual(parsed.attributes.stats, { DEX: 18 });

    const empty = parsePcg('# just comments\n\n   \n');
    assert.equal(empty.bio.name, null);
    assert.deepEqual(empty.unknownLines, []);
  });

  test('handles real PCGen 6.08 conventions (TEMPLATESAPPLIED, bracketed WEAPONPROF, SPELLLEVEL/SOURCE/FEATLIST, ability pools, trailing pipes)', () => {
    const pcg608 = `PCGVERSION:2.0
VERSION:6.08.00 RC10
GAMEMODE:Pathfinder_RPG
CHARACTERNAME:Dannog
RACE:Android
DEITY:Desna|DEITYDOMAINS:[DOMAIN:Chaos|DOMAIN:Good]|HOLYITEM:None|DEITYFAVWEAP:[WEAPON:Starknife]|DEITYALIGN:CG
DOMAIN:Animal|DOMAINGRANTS:You cast Animal Friendship once per day.|SOURCE:[TYPE:CLASS|NAME:Cleric]
CLASS:Wizard|SUBCLASS:Evoker|LEVEL:1|SKILLPOOL:0
CLASSABILITIESLEVEL:Wizard=1|HITPOINTS:6|SPECIALTIES:[SPECIALTY:Evocation]|SKILLSGAINED:4|SKILLSREMAINING:0
TEMPLATESAPPLIED:[NAME:Creature with Class Levels]
TEMPLATESAPPLIED:[NAME:Racial Heritage ~ Elf|CHOSENTEMPLATE:[NAME:IsElf]]
SKILL:Acrobatics|OUTPUTORDER:1|
ABILITY:Alchemist Discovery|TYPE:NORMAL|CATEGORY:Special Ability|KEY:Discovery ~ Feral Mutagen|TYPE:AlchemistDiscovery
ABILITY:*LANGBONUS|TYPE:VIRTUAL|CATEGORY:*LANGBONUS|KEY:*LANGBONUS|APPLIEDTO:Orc,Hallit,Androffan|TYPE:
WEAPONPROF:[WEAPON:Club|WEAPON:Crossbow (Heavy)|WEAPON:Dagger]
EQUIPSET:Default Set|ID:0.1|USETEMPMODS:Y
EQUIPSET:Both Hands|ID:0.1.03|VALUE:Longspear|QUANTITY:1.0|USETEMPMODS:Y
SPELLNAME:Color Spray|TIMES:2|CLASS:Wizard|BOOK:Prepared Spells|SPELLLEVEL:1|SOURCE:[TYPE:CLASS|NAME:Wizard]|FEATLIST:[FEAT:Empower Spell]
FOLLOWER:Hare|TYPE:Familiar|RACE:FAMILIAR (SCORPION (GREENSTING))|HITDICE:0|ADJUSTMENT:0|FILE:Everything.pcg
SUPPRESSBIOFIELDS:
`;
    const parsed = parsePcg(pcg608);

    assert.deepEqual(parsed.unknownLines, []);
    assert.deepEqual(parsed.warnings, []);
    assert.equal(parsed.attributes.deity?.holyItem, 'None');
    assert.equal(parsed.attributes.domains[0]?.grants, 'You cast Animal Friendship once per day.');
    assert.deepEqual(parsed.classLevels[0]?.specialties, ['Evocation']);
    assert.deepEqual(parsed.attributes.templates, ['Creature with Class Levels', 'Racial Heritage ~ Elf']);
    assert.deepEqual(parsed.attributes.appliedTemplates[1], {
      name: 'Racial Heritage ~ Elf',
      chosenTemplates: ['IsElf'],
      extra: [],
    });
    assert.deepEqual(parsed.skills[0]?.extra, []);
    assert.equal(parsed.abilities[0]?.pool, 'Alchemist Discovery');
    assert.equal(parsed.abilities[0]?.category, 'Special Ability');
    assert.deepEqual(parsed.abilities[1]?.appliedTo, ['Orc', 'Hallit', 'Androffan']);
    assert.deepEqual(parsed.attributes.weaponProficiencies, ['Club', 'Crossbow (Heavy)', 'Dagger']);
    assert.equal(parsed.equipmentSets[0]?.items[0]?.useTempMods, true);
    assert.equal(parsed.spells.entries[0]?.level, 1);
    assert.deepEqual(parsed.spells.entries[0]?.source, { TYPE: 'CLASS', NAME: 'Wizard' });
    assert.deepEqual(parsed.spells.entries[0]?.metamagic, ['Empower Spell']);
    assert.equal(parsed.companions.followers[0]?.race, 'FAMILIAR (SCORPION (GREENSTING))');
    assert.equal(parsed.companions.followers[0]?.adjustment, 0);
  });

  test('CLI pcgen subcommand converts a .pcg file to JSON on stdout and to an output file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pcgen-cli-test-'));
    try {
      const inFile = path.join(dir, 'valeros.pcg');
      const outFile = path.join(dir, 'valeros.json');
      fs.writeFileSync(inFile, SAMPLE_PF1E_PCG, 'utf8');

      const cliPath = path.resolve(import.meta.dirname, '../src/cli.ts');
      const tsxBin = path.resolve(import.meta.dirname, '../../../node_modules/.bin/tsx');

      const stdout = execFileSync(tsxBin, [cliPath, 'pcgen', inFile], { encoding: 'utf8' });
      const fromStdout = PcgenCharacterSchema.parse(JSON.parse(stdout));
      assert.equal(fromStdout.bio.name, 'Valeros & Friends');

      execFileSync(tsxBin, [cliPath, 'pcgen', inFile, outFile], { encoding: 'utf8' });
      const fromFile = PcgenCharacterSchema.parse(JSON.parse(fs.readFileSync(outFile, 'utf8')));
      assert.deepEqual(fromFile, fromStdout);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
