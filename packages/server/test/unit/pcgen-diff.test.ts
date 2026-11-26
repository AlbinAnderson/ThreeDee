import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  buildName,
  carriedWeight,
  containerChain,
  containerContentsWeight,
  decodePcgenEntities,
  diffCharacterBuild,
  isCarried,
  litLight,
  makeItem,
  mergeReimport,
  parsePcg,
  seedInventory,
  splitBracketAware,
  wouldCycle,
  type Inventory,
} from '@vtt/shared';
import { makePcgCharacter, SAMPLE_PCG } from '../helpers/harness';

describe('unit: PCGen tokenizer, parser, re-import & diff', () => {
  test('decodes entities once and preserves nested bracket pipes', () => {
    assert.equal(decodePcgenEntities('A &amp;amp; B&colon; C&pipe;D&nl;E'), 'A &amp; B: C|D\nE');
    assert.deepEqual(splitBracketAware('A:1|B:[X:1|Y:[Z:2]]|C:3', '|'), ['A:1', 'B:[X:1|Y:[Z:2]]', 'C:3']);
  });

  test('buildName, mergeReimport and diffCharacterBuild preserve custom name and detect changes', () => {
    const c = makePcgCharacter(SAMPLE_PCG, { fileName: 'hero.pcg', now: 10 });
    assert.equal(buildName(c.build), 'Valeros & Friends');

    const customized = { ...c, name: 'Captain Valeros' };
    const nextBuild = parsePcg(SAMPLE_PCG.replace('CLASS:Fighter|LEVEL:2', 'CLASS:Fighter|LEVEL:3').replace('MONEY:42.5', 'MONEY:100'));
    const diff = diffCharacterBuild(c.build, nextBuild);
    assert.ok(diff.some((d) => d.section === 'Classes' && d.text.includes('Fighter 3')));
    assert.ok(diff.some((d) => d.section === 'Money (gp)'));

    const keptInv = mergeReimport(customized, nextBuild, { fileName: 'hero-v2.pcg', importedBy: 'alice', now: 20 });
    assert.equal(keptInv.name, 'Captain Valeros');
    assert.deepEqual(keptInv.inventory, customized.inventory);

    const replacedInv = mergeReimport(customized, nextBuild, { fileName: 'hero-v2.pcg', importedBy: 'alice', now: 20, replaceInventory: true });
    assert.equal(replacedInv.inventory.coins.gp, 100);
  });
});

describe('unit: inventory seeding, containers, weight & carried light', () => {
  test('seedInventory maps EQUIPSET locations, containers, unplaced items and coins', () => {
    const inv = seedInventory(parsePcg(SAMPLE_PCG));
    assert.equal(inv.items.length, 3);
    assert.equal(inv.loadouts[0]!.slots[inv.items[0]!.id], 'primary');
    assert.equal(inv.items[2]!.containerId, inv.items[1]!.id);
    assert.deepEqual(inv.coins, { pp: 0, gp: 42, sp: 5, cp: 0 });
  });

  test('container cycle detection, carried weight, extradimensional nesting and brightest lit light', () => {
    const inv: Inventory = {
      items: [
        makeItem({ id: 'pack', name: 'Backpack', weight: 2, container: { extradimensional: false, capacity: 60 } }),
        makeItem({ id: 'boh', name: 'Bag of Holding', weight: 15, containerId: 'pack', container: { extradimensional: true, capacity: 250 } }),
        makeItem({ id: 'anvil', name: 'Anvil', weight: 100, containerId: 'boh' }),
        makeItem({ id: 'candle', name: 'Candle', weight: 0, light: { bright: 0, dim: 5 }, lit: true }),
        makeItem({ id: 'lantern', name: 'Lantern', weight: 2, light: { bright: 30, dim: 60 }, lit: true }),
        makeItem({ id: 'stowedTorch', name: 'Torch', weight: 1, containerId: 'pack', light: { bright: 60, dim: 120 }, lit: true }),
      ],
      coins: { pp: 0, gp: 50, sp: 0, cp: 0 }, // 1 lb
      loadouts: [{ id: 'l1', name: 'Default', slots: {} }],
      activeLoadoutId: 'l1',
    };

    assert.equal(wouldCycle(inv, 'pack', 'pack'), true);
    assert.equal(wouldCycle(inv, 'pack', 'boh'), true);
    assert.equal(wouldCycle(inv, 'anvil', 'pack'), false);
    assert.deepEqual(containerChain(inv, inv.items[2]!).map((c) => c.id), ['boh', 'pack']);

    assert.equal(containerContentsWeight(inv, 'boh'), 100);
    assert.equal(containerContentsWeight(inv, 'pack'), 15 + 1, 'extradimensional anvil does not weigh on outer backpack');
    assert.deepEqual(carriedWeight(inv), { total: 2 + 15 + 2 + 1 + 1, gear: 20, coins: 1, extradimensional: 100 });
    assert.equal(litLight(inv)?.name, 'Lantern', 'stowed torch inside container is ignored; brightest carried light wins');

    inv.loadouts[0]!.slots.pack = 'notCarried';
    assert.equal(isCarried(inv, inv.loadouts[0]!, inv.items[2]!), false, 'dropping outer container drops nested items');
  });
});
