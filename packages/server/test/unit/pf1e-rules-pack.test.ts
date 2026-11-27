import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, test } from 'node:test';
import {
  addToPurse,
  aonPageKind,
  aonUrl,
  applyRecordToItem,
  checkCampaigns,
  computeCharacterStats,
  itemFromRecord,
  makeItem,
  matchCampaign,
  monsterToCharacter,
  monsterToken,
  normalizeAonUrl,
  parseAonMonsterHtml,
  parseAonPage,
  parseSpellArea,
  partySourceKeys,
  priceWithMods,
  sellValueCp,
  treasureFromRecord,
  type EquipmentRecord,
} from '@vtt/shared';
import { buildRulesPack } from '../../src/rules/buildPack';
import { createRulesPackStore } from '../../src/rules/packStore';
import { makePcgCharacter } from '../helpers/harness';

const tmpDirs: string[] = [];
function makeTmp(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe('unit: [Epic 11] PCGen rules pack builder & helpers', () => {
  test('builds .pcc/.lst pack with .COPY, .MOD, .FORGET, CATEGORY:FEAT split and homebrew', () => {
    const root = makeTmp('pcgen-unit-');
    const pfDir = path.join(root, 'pathfinder');
    const hbDir = path.join(root, 'homebrew');
    const outDir = path.join(root, 'out');
    fs.mkdirSync(pfDir, { recursive: true });
    fs.mkdirSync(hbDir, { recursive: true });

    fs.writeFileSync(
      path.join(pfDir, 'core.pcc'),
      [
        'CAMPAIGN:Core Rulebook',
        'KEY:Core Rulebook',
        'SOURCELONG:Core Rulebook',
        'SOURCESHORT:CR',
        'PUBNAMELONG:Paizo',
        'BOOKTYPE:Core Rulebook',
        'EQUIPMENT:cr_equip.lst',
        'SPELL:cr_spells.lst',
        'ABILITY:cr_feats.lst',
        'DEITY:cr_deities.lst',
      ].join('\n'),
    );
    fs.writeFileSync(
      path.join(pfDir, 'cr_equip.lst'),
      [
        'Longsword\tKEY:Longsword\tTYPE:Weapon.Martial.Melee.OneHanded.Slashing\tCOST:15\tWT:4\tDAMAGE:1d8\tCRITRANGE:2\tCRITMULT:x2\tWIELD:OneHanded\tSOURCEPAGE:p.143\tDESC:A classic straight blade.',
        'Obsolete Item\tKEY:Obsolete Item\tTYPE:Goods\tCOST:1\tWT:1\tDESC:Removed later.',
        'Longsword.COPY=Silvered Blade\tCOST:105\tDESC:A copied silvered blade.',
      ].join('\n'),
    );
    fs.writeFileSync(
      path.join(pfDir, 'cr_spells.lst'),
      'Fireball\tSCHOOL:Evocation\tDESCRIPTOR:Fire\tCLASSES:Wizard,Sorcerer=3\tCASTTIME:1 standard action\tCOMPS:V, S, M\tRANGE:Long\tTARGETAREA:20-ft.-radius spread\tDURATION:Instantaneous\tSAVEINFO:Reflex half\tSPELLRES:Yes\tSOURCEPAGE:p.283\tDESC:A fiery explosion.',
    );
    fs.writeFileSync(
      path.join(pfDir, 'cr_feats.lst'),
      [
        'Power Attack\tCATEGORY:FEAT\tTYPE:Combat\tPRESTAT:1,STR=13\tPREATT:1\tSOURCEPAGE:p.131\tDESC:Trade accuracy for melee damage.',
        'Trapfinding\tCATEGORY:Special Ability\tTYPE:SpecialQuality.Extraordinary\tSOURCEPAGE:p.68\tDESC:Spot traps.',
      ].join('\n'),
    );
    fs.writeFileSync(
      path.join(pfDir, 'cr_deities.lst'),
      'Iomedae\tALIGN:LG\tDOMAINS:Glory,Good,Law,Sun,War\tDEITYWEAP:Longsword\tSYMBOL:Longsword and starburst\tSOURCEPAGE:p.43',
    );

    // Homebrew modifies Longsword, forgets Obsolete Item, and adds a custom item.
    fs.writeFileSync(
      path.join(hbDir, 'hb.pcc'),
      ['CAMPAIGN:House Rules', 'KEY:House Rules', 'SOURCELONG:House Rules', 'SOURCESHORT:HR', 'PUBNAMELONG:GM', 'EQUIPMENT:hb_equip.lst'].join('\n'),
    );
    fs.writeFileSync(
      path.join(hbDir, 'hb_equip.lst'),
      [
        'Longsword.MOD\tDESC:Modified by house rules.',
        'Obsolete Item.FORGET',
        'Sunblade Prototype\tTYPE:Weapon.Magic.Martial.Melee\tCOST:4000\tWT:2\tDAMAGE:1d8\tQUALITY:Caster Level|7\tDESC:Glows brightly.',
      ].join('\n'),
    );

    const { manifest } = buildRulesPack(pfDir, outDir);
    assert.equal(manifest.counts.equipment, 3);
    assert.equal(manifest.counts.spell, 1);
    assert.equal(manifest.counts.feat, 1);
    assert.equal(manifest.counts.ability, 1);
    assert.equal(manifest.counts.deity, 1);

    const store = createRulesPackStore(outDir);
    assert.equal(store.loaded, true);
    // PCGen DESC is additive: a .MOD DESC adds a paragraph (DESC:.CLEAR would replace).
    assert.equal(store.get('equipment', 'Longsword')?.desc, 'A classic straight blade.\n\nModified by house rules.');
    assert.equal(store.get('equipment', 'Obsolete Item'), undefined);
    assert.equal(store.get('equipment', 'Silvered Blade')?.cost, 105);
    assert.equal(store.get('equipment', 'Sunblade Prototype')?.cl, 7);
    assert.equal(store.byName('feat', 'Power Attack')?.prereqs, 'STR 13; BAB +1');
    assert.equal(store.byName('spell', 'Fireball')?.source.page, 'p.283');
    assert.equal(store.byName('deity', 'Iomedae')?.favoredWeapon, 'Longsword');
  });

  test('AoN deep links and strict SSRF URL allowlist', () => {
    assert.equal(aonUrl('spell', 'Invisibility (Greater)'), 'https://www.aonprd.com/SpellDisplay.aspx?ItemName=Invisibility%2C%20Greater');
    assert.equal(aonUrl('trait', 'Trait ~ Reactionary'), 'https://www.aonprd.com/TraitDisplay.aspx?ItemName=Reactionary');
    assert.equal(normalizeAonUrl('https://aonprd.com/MonsterDisplay.aspx?ItemName=Goblin'), 'https://www.aonprd.com/MonsterDisplay.aspx?ItemName=Goblin');
    assert.equal(aonPageKind('https://www.aonprd.com/MonsterDisplay.aspx?ItemName=Goblin'), 'monster');
    assert.equal(aonPageKind('https://www.aonprd.com/SpellDisplay.aspx?ItemName=Fireball'), 'spell');

    // SSRF rejections
    assert.equal(normalizeAonUrl('http://www.aonprd.com/SpellDisplay.aspx?ItemName=Fireball'), null);
    assert.equal(normalizeAonUrl('https://evil.example/SpellDisplay.aspx?ItemName=Fireball'), null);
    assert.equal(normalizeAonUrl('https://www.aonprd.com:8443/SpellDisplay.aspx?ItemName=Fireball'), null);
    assert.equal(normalizeAonUrl('https://user@www.aonprd.com/SpellDisplay.aspx?ItemName=Fireball'), null);
    assert.equal(normalizeAonUrl('https://www.aonprd.com/Search.aspx?Query=Fireball'), null);
    assert.equal(normalizeAonUrl('http://169.254.169.254/latest/meta-data/'), null);
  });

  test('equipment mods pricing, exact gear enrichment, selling and spell area parsing', () => {
    const longsword: EquipmentRecord = {
      kind: 'equipment',
      key: 'Longsword',
      name: 'Longsword',
      source: { campaign: 'Core Rulebook', long: 'Core Rulebook', short: 'CR', page: 'p.143' },
      desc: 'A straight blade.',
      types: ['Weapon', 'Martial', 'Melee', 'OneHanded'],
      cost: 15,
      weight: 4,
      baseItem: null,
      damage: '1d8',
      critRange: 2,
      critMult: 2,
      range: null,
      wield: 'OneHanded',
      acBonus: null,
      maxDex: null,
      acp: null,
      asf: null,
      slot: null,
      cl: null,
      aura: null,
      eqmods: [],
      spellEffect: null,
    };
    // +1 Cold Iron Longsword = 15 + 15 (cold iron) + 2000 (cold iron enchant surcharge) + 300 (mwk) + 2000 (+1) = 4330 gp
    const priced = priceWithMods(longsword, { masterwork: true, material: 'coldIron', enhancement: 1 });
    assert.ok(typeof priced !== 'string');
    assert.equal(priced.cost, 4330);

    const built = itemFromRecord(longsword, 'sw1', { masterwork: true, material: 'mithral', enhancement: 0 }, 1);
    assert.ok(typeof built !== 'string');
    assert.equal(built.weight, 2); // Mithral halves weight
    assert.equal(built.value, 2015); // 15 + 500 * 4 lb

    const upgraded = applyRecordToItem(makeItem({ id: 'i1', name: 'Longsword', value: 0, weight: 0 }), longsword);
    assert.equal(upgraded.weapon?.damage, '1d8');
    assert.equal(upgraded.weapon?.critRange, 19);
    assert.equal(upgraded.ruleKey, 'Longsword');

    // Selling: 50% normal, 100% tradeGood
    assert.equal(sellValueCp({ value: 15, tradeGood: false }, 2), 1500);
    assert.equal(sellValueCp({ value: 50, tradeGood: true }, 1), 5000);
    assert.deepEqual(addToPurse({ pp: 0, gp: 1, sp: 0, cp: 0 }, 1550), { pp: 0, gp: 16, sp: 5, cp: 0 });

    // Spell areas
    assert.deepEqual(parseSpellArea('20-ft.-radius spread')?.kind, 'circle');
    assert.equal(parseSpellArea('30-ft. cone')?.feet, 30);
    assert.equal(parseSpellArea('120-ft. line')?.kind, 'line');
    assert.equal(parseSpellArea('one creature'), null);

    // Source warnings & party books
    const books = [{ key: 'Core Rulebook', name: 'Core Rulebook' }];
    const warnings = checkCampaigns(['Core Rulebook', 'Ultimate Combat'], books, ['Core Rulebook']);
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0]!.reason, 'missing');
    const c = makePcgCharacter();
    c.build.system.campaigns = ['Paizo - Pathfinder Roleplaying Game Core Rulebook'];
    assert.deepEqual(partySourceKeys([c], books), ['Core Rulebook']);

    // Treasure generation (unidentified magic item)
    const cloak: EquipmentRecord = { ...longsword, key: 'Cloak +1', name: 'Cloak of Resistance +1', types: ['Magic', 'Wondrous'], slot: 'shoulders', cost: 1000, cl: 5, aura: 'faint abjuration' };
    const tr = treasureFromRecord(cloak);
    assert.equal(tr.item.name, 'Unidentified cloak');
    assert.equal(tr.secret.trueName, 'Cloak of Resistance +1');
    assert.equal(tr.secret.cl, 5);
  });

  test('AoN item/spell/feat and monster HTML parsers + stat-block attacks in engine', () => {
    const itemHtml = `
      <h1 class="title">Cloak of Resistance +2</h1>
      <b>Source</b> <i>Core Rulebook pg. 506</i><br/>
      <b>Aura</b> faint abjuration; <b>CL</b> 5th; <b>Slot</b> shoulders; <b>Price</b> 4,000 gp; <b>Weight</b> 1 lb.
      <h3 class="framing">Description</h3>
      Grants a +2 resistance bonus on all saving throws.
    `;
    const draft = parseAonPage(itemHtml, 'https://www.aonprd.com/MagicWondrousDisplay.aspx?ItemName=Cloak%20of%20Resistance');
    assert.equal(draft.kind, 'rule');
    assert.equal(draft.rule.kind, 'equipment');
    assert.equal(draft.rule.name, 'Cloak of Resistance +2');
    assert.equal(draft.rule.cost, 4000);
    assert.equal(draft.rule.cl, 5);
    assert.equal(draft.rule.slot, 'shoulders');

    const monsterHtml = `
      <h2 class="title">Goblin CR 1/3</h2>
      <b>Source</b> <i>Bestiary pg. 156</i><br/>
      <b>XP</b> 135<br/>
      NE Small humanoid (goblinoid)<br/>
      <b>Init</b> +6; <b>Senses</b> darkvision 60 ft.; Perception -1
      <h3 class="framing">Defense</h3>
      <b>AC</b> 16, touch 13, flat-footed 14 (+2 armor, +2 Dex, +1 shield, +1 size)<br/>
      <b>hp</b> 6 (1d10+1)<br/>
      <b>Fort</b> +3, <b>Ref</b> +2, <b>Will</b> -1
      <h3 class="framing">Offense</h3>
      <b>Speed</b> 30 ft.<br/>
      <b>Melee</b> short sword +2 (1d4/19-20)<br/>
      <b>Ranged</b> shortbow +4 (1d4/x3)<br/>
      <b>Space</b> 5 ft.; <b>Reach</b> 5 ft.
      <h3 class="framing">Statistics</h3>
      <b>Str</b> 11, <b>Dex</b> 15, <b>Con</b> 12, <b>Int</b> 10, <b>Wis</b> 9, <b>Cha</b> 6<br/>
      <b>Base Atk</b> +1; <b>CMB</b> +0; <b>CMD</b> 12<br/>
      <b>Feats</b> Improved Initiative<br/>
      <b>Skills</b> Ride +10, Stealth +10, Swim +4
    `;
    const m = parseAonMonsterHtml(monsterHtml, 'https://www.aonprd.com/MonsterDisplay.aspx?ItemName=Goblin');
    assert.equal(m.name, 'Goblin');
    assert.equal(m.hp.total, 6);
    assert.equal(m.ac.total, 16);
    assert.equal(m.senses.darkvision, 60);
    assert.equal(m.melee.length, 1);
    assert.equal(m.ranged.length, 1);

    const npc = monsterToCharacter(m, { id: 'gob1', now: 1, importedBy: 'gm' });
    assert.equal(npc.ownerId, null);
    assert.equal(npc.shared, false);
    const stats = computeCharacterStats(npc);
    assert.equal(stats.hp.total, 6);
    assert.equal(stats.ac.normal.total, 16);
    assert.equal(stats.saves.fort.total, 3);
    assert.equal(stats.saves.ref.total, 2);
    assert.equal(stats.saves.will.total, -1);
    assert.equal(stats.initiative.total, 6);
    assert.ok(stats.attacks.some((a) => a.name.toLowerCase().includes('short sword') && a.attack.total === 2));
    assert.ok(stats.attacks.some((a) => a.name.toLowerCase().includes('shortbow') && a.attack.total === 4));

    const tok = monsterToken(m, { id: 'tok1', sceneId: 's1', x: 70, y: 70, unitsPerCell: 5 });
    assert.equal(tok.hidden, true);
    assert.equal(tok.hp?.max, 6);
    assert.equal(tok.darkvision, 12);
  });

  test('MultiSet meta-bundles do not steal book ownership from standalone supplements', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vtt-multiset-'));
    try {
      const pf = path.join(tmp, 'pathfinder');
      const ucDir = path.join(pf, 'paizo', 'ultimate_combat');
      fs.mkdirSync(ucDir, { recursive: true });
      fs.writeFileSync(
        path.join(pf, 'paizo', 'pathfinder_rpg_core.pcc'),
        [
          'CAMPAIGN:Pathfinder RPG Core Supplements',
          'KEY:Pathfinder RPG Core Supplements',
          'BOOKTYPE:MultiSet',
          'PUBNAMELONG:Paizo Inc.',
          'SOURCELONG:Pathfinder Core',
          'SOURCESHORT:PC',
          'PCC:@/paizo/ultimate_combat/ultimate_combat.pcc',
        ].join('\n'),
      );
      fs.writeFileSync(
        path.join(ucDir, 'ultimate_combat.pcc'),
        [
          'CAMPAIGN:Ultimate Combat',
          'BOOKTYPE:Supplement',
          'PUBNAMELONG:Paizo Inc.',
          'SOURCELONG:Ultimate Combat',
          'SOURCESHORT:UC',
          'EQUIPMENT:uc_equip.lst',
        ].join('\n'),
      );
      fs.writeFileSync(path.join(ucDir, 'uc_equip.lst'), 'Katana\tTYPE:Weapon.Melee.Exotic\tCOST:50\tWT:6\tDAMAGE:1d8\n');

      const out = path.join(tmp, 'out');
      const { manifest } = buildRulesPack(pf, out);
      assert.ok(manifest.books.some((b) => b.key === 'Ultimate Combat' && b.records === 1));
      assert.ok(!manifest.books.some((b) => b.key === 'Pathfinder RPG Core Supplements'));

      // Variant campaign lines ("~ Player Options Only", "PFS ~") and MultiSets match their base books.
      const books = [
        { key: 'Core Rulebook', name: 'Core Rulebook' },
        { key: 'Bestiary 2', name: 'Bestiary 2' },
        { key: 'Bestiary 3', name: 'Bestiary 3' },
      ];
      assert.equal(matchCampaign('Bestiary 2 ~ Player Options Only', books)?.key, 'Bestiary 2');
      assert.equal(matchCampaign('Bestiary 3 ~ Player Options Only', books)?.key, 'Bestiary 3');
      assert.equal(matchCampaign('PFS ~ Core Rulebook', books)?.key, 'Core Rulebook');
      assert.equal(matchCampaign('Pathfinder RPG Core Supplements', books)?.key, 'Core Rulebook');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
