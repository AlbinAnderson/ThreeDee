import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import {
  carryingCapacity,
  characterActions,
  characterSheetActions,
  coinsFromGp,
  computeCharacterStats,
  containerContentsWeight,
  createCharacterFromPcg,
  createInitialState,
  createToken,
  CURRENT_SCHEMA_VERSION,
  detectGear,
  inventoryActions,
  lootActions,
  makeItem,
  migrateState,
  newId,
  parseGpValue,
  parsePcg,
  payFromPurse,
  redactState,
  seedInventory,
  sizedDamage,
  tokenActions,
  type Character,
  type GameAction,
  type ServerMessage,
  type User,
} from '@vtt/shared';
import { SqliteRoomStore } from '../src/persistence/SqliteRoomStore';
import { Room, type Client } from '../src/rooms/Room';

const SAMPLE = fs.readFileSync(new URL('./fixtures/sample-pf1e.pcg', import.meta.url), 'utf8');

let dir: string;
let store: SqliteRoomStore;
const openRooms: Room[] = [];
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vtt-test-'));
  store = new SqliteRoomStore(path.join(dir, 'vtt.db'));
});
afterEach(async () => {
  for (const r of openRooms.splice(0)) await r.flush({ autoSnapshot: false });
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const gmUser: User = { id: 'gm1', name: 'Dana', role: 'gm', color: '#ff0000' };
const alice: User = { id: 'alice', name: 'Alice', role: 'player', color: '#00ff00' };
const bob: User = { id: 'bob', name: 'Bob', role: 'player', color: '#0000ff' };

type TestClient = Client & { inbox: ServerMessage[]; rejects(): string[] };
function client(): TestClient {
  const inbox: ServerMessage[] = [];
  return { id: newId(), user: null, room: null, seq: 0, inbox, send: (m) => inbox.push(m), rejects: () => inbox.flatMap((m) => (m.t === 'reject' ? [m.reason] : [])) };
}

const character = (pcg = SAMPLE): Character =>
  createCharacterFromPcg(parsePcg(pcg), { id: 'char', ownerId: 'alice', fileName: 'v.pcg', importedBy: 'alice', now: 1 });

/** Alice's (unshared) character linked to token "hero"; Bob is another player. */
function setup() {
  const room = new Room('main', createInitialState('scene1'), store, { autoIntervalMs: 1e12, keepAllForMs: 1e12, keepDailyForMs: 1e12 });
  openRooms.push(room);
  const g = client();
  const a = client();
  const b = client();
  room.join(g, gmUser);
  room.join(a, alice);
  room.join(b, bob);
  const act = (c: Client, action: GameAction) => room.handleClientAction(c, newId(), action);
  act(a, characterActions.import.create({ character: character() }));
  act(g, tokenActions.create.create({ token: createToken({ id: 'hero', sceneId: 'scene1', x: 0, y: 0, ownerIds: ['alice'] }) }));
  act(a, characterActions.linkToken.create({ id: 'char', tokenId: 'hero' }));
  const inv = () => room.currentState.characters.char!.inventory;
  const item = (name: string) => inv().items.find((i) => i.name === name)!;
  return { room, g, a, b, act, inv, item };
}

describe('inventory seeding from .pcg', () => {
  test('items, containers, loadout slots and coins come from EQUIPNAME / EQUIPSET / MONEY', () => {
    const inv = character().inventory;
    assert.deepEqual(
      inv.items.map((i) => i.name),
      ['Longsword (Masterwork)', 'Backpack', 'Trail Rations'],
    );
    const [sword, pack, rations] = inv.items;
    assert.equal(sword!.weapon?.damage, '1d8');
    assert.equal(sword!.weapon?.masterwork, true);
    assert.ok(sword!.notes.startsWith('Family heirloom'), 'PCGen note kept');
    assert.ok(pack!.container, 'backpack is a container');
    assert.equal(rations!.containerId, pack!.id, 'rations are in the backpack');
    assert.equal(rations!.quantity, 5);
    assert.equal(inv.loadouts.length, 1);
    assert.equal(inv.loadouts[0]!.name, 'Default Set');
    assert.equal(inv.loadouts[0]!.slots[sword!.id], 'primary');
    assert.deepEqual(inv.coins, { pp: 0, gp: 42, sp: 5, cp: 0 });
  });

  test('PCGen armor in Body and shields in a hand are equipped; unplaced items are not carried', () => {
    const inv = seedInventory(
      parsePcg(
        `${SAMPLE}\nEQUIPNAME:+1 Chain Shirt|OUTPUTORDER:4|COST:1250|WT:25|QUANTITY:1.0\nEQUIPNAME:Shield (Small/Wood)|OUTPUTORDER:5|COST:3|WT:5|QUANTITY:1.0\nEQUIPNAME:Dagger|OUTPUTORDER:6|COST:2|WT:1|QUANTITY:1.0\nEQUIPSET:Body|ID:0.1.3|VALUE:+1 Chain Shirt|QUANTITY:1.0\nEQUIPSET:Off Hand|ID:0.1.4|VALUE:Shield (Small/Wood)|QUANTITY:1.0\n`,
      ),
    );
    const slot = (name: string) => inv.loadouts[0]!.slots[inv.items.find((i) => i.name === name)!.id];
    assert.equal(slot('+1 Chain Shirt'), 'armor');
    assert.equal(slot('Shield (Small/Wood)'), 'shield');
    assert.equal(slot('Dagger'), 'notCarried');
    const shirt = inv.items.find((i) => i.name === '+1 Chain Shirt')!;
    assert.deepEqual(shirt.armor, { kind: 'armor', category: 'light', bonus: 4, enhancement: 1, maxDex: 4, acp: -1, asf: 20 }, 'magic armor is masterwork: ACP -2 becomes -1');
    assert.equal(inv.items.find((i) => i.name === 'Shield (Small/Wood)')!.armor?.bonus, 1);
  });
});

describe('encumbrance, armor and attacks', () => {
  test('masterwork longsword: attack, damage, crit; two hands give 1.5x Str', () => {
    const c = character();
    const s = computeCharacterStats(c);
    const sword = s.attacks.find((x) => x.name === 'Longsword (Masterwork)')!;
    assert.equal(sword.attack.total, 2 + 3 + 1, 'BAB 2 + Str 3 + masterwork 1');
    assert.equal(sword.dice, '1d8');
    assert.equal(sword.damage.total, 3);
    assert.equal(sword.crit, '19-20/×2');
    assert.deepEqual(sword.fullAttack, [6], 'BAB 2: one attack');

    c.inventory.loadouts[0]!.slots[c.inventory.items[0]!.id] = 'bothHands';
    assert.equal(computeCharacterStats(c).attacks[0]!.damage.total, 4, 'floor(3 x 1.5)');
  });

  test('two-weapon fighting penalties, off-hand half Str, iterative attacks', () => {
    const c = character(SAMPLE.replace('CLASS:Fighter|LEVEL:2', 'CLASS:Fighter|LEVEL:7').replace('CLASSABILITIESLEVEL:Fighter=2', 'CLASSABILITIESLEVEL:Fighter=7'));
    c.inventory.items.push(makeItem({ id: 'dg', name: 'Dagger', weight: 1, weapon: { damage: '1d4', critRange: 19, critMult: 2, range: 10, type: 'melee', hands: 'light', finesse: true, strDamage: 'full', enhancement: 0, masterwork: false } }));
    c.inventory.loadouts[0]!.slots.dg = 'offHand';
    const s = computeCharacterStats(c);
    const sword = s.attacks.find((x) => x.hand === 'primary')!;
    assert.deepEqual(sword.fullAttack, [sword.attack.total, sword.attack.total - 5], 'BAB 7: two attacks');
    const dagger = s.attacks.find((x) => x.hand === 'offHand' && x.mode === 'melee')!;
    assert.equal(dagger.damage.total, 1, 'off hand: half of Str 3');
    assert.ok(s.attacks.some((x) => x.itemId === 'dg' && x.mode === 'thrown'), 'daggers can be thrown');
    assert.deepEqual(s.twoWeapon?.primary, sword.fullAttack.map((n) => n - 4), 'light off-hand weapon, no feat: -4 / -8');
    assert.deepEqual(s.twoWeapon?.offHand, [dagger.attack.total - 8]);
  });

  test('load: medium load caps Dex at 3, gives -3 ACP and slows to 20 ft; extradimensional and not-carried gear is free', () => {
    const c = character(SAMPLE.replace('STAT:DEX|SCORE:15', 'STAT:DEX|SCORE:20'));
    const light = computeCharacterStats(c);
    assert.equal(light.load.level, 'light');
    assert.equal(light.load.weight.total, 4 + 2 + 5 + 0.94, 'sword + backpack + 5 rations + 47 coins');
    assert.deepEqual(light.load.capacity, { light: 86, medium: 173, heavy: 260 }, 'Str 17');

    c.inventory.items.push(makeItem({ id: 'anvil', name: 'Anvil', weight: 100 }));
    const medium = computeCharacterStats(c);
    assert.equal(medium.load.level, 'medium');
    assert.equal(medium.armor.maxDex, 3);
    assert.equal(medium.armor.acp, -3);
    assert.equal(medium.speed.total, 20);
    assert.equal(medium.ac.normal.total, 10 + 3, 'Dex +5 capped at +3');

    c.inventory.items.push(makeItem({ id: 'bag', name: 'Bag of Holding (Type I)', weight: 15, container: { extradimensional: true, capacity: 250 } }));
    c.inventory.items.find((i) => i.id === 'anvil')!.containerId = 'bag';
    assert.equal(computeCharacterStats(c).load.level, 'light', 'the anvil is in the bag of holding');
    assert.equal(computeCharacterStats(c).load.weight.extradimensional, 100);

    c.inventory.loadouts[0]!.slots.bag = 'notCarried';
    assert.equal(computeCharacterStats(c).load.weight.total, light.load.weight.total, 'the bag (and its contents) left behind');
  });

  test('rules helpers: capacity above Str 29, Small weapons, coins and making change', () => {
    assert.equal(carryingCapacity(30, 'Medium').heavy, 1600);
    assert.equal(carryingCapacity(10, 'Small').heavy, 75);
    assert.equal(sizedDamage('1d8', 'Small'), '1d6');
    assert.equal(sizedDamage('2d6', 'Small'), '1d10');
    assert.equal(sizedDamage('1d8', 'Large'), '2d6');
    assert.deepEqual(coinsFromGp(31.3), { pp: 0, gp: 31, sp: 3, cp: 0 });
    assert.deepEqual(payFromPurse({ pp: 0, gp: 1, sp: 3, cp: 0 }, 45), { pp: 0, gp: 0, sp: 8, cp: 5 });
    assert.equal(payFromPurse({ pp: 0, gp: 1, sp: 0, cp: 0 }, 101), null);
    assert.equal(parseGpValue('250 gp'), 250);
    assert.equal(parseGpValue('3 pp 4 sp'), 30.4);
  });
});

describe('inventory actions', () => {
  test('equipping evicts the slot; containers reject cycles; steppers; loadouts switch what is worn', () => {
    const { room, a, act, inv, item } = setup();
    act(a, inventoryActions.addItem.create({ characterId: 'char', item: makeItem({ id: 'plate', name: 'Full Plate', weight: 50, armor: { kind: 'armor', category: 'heavy', bonus: 9, enhancement: 0, maxDex: 1, acp: -6, asf: 35 } }) }));
    act(a, inventoryActions.addItem.create({ characterId: 'char', item: makeItem({ id: 'shirt', name: 'Chain Shirt', weight: 25, armor: { kind: 'armor', category: 'light', bonus: 4, enhancement: 0, maxDex: 4, acp: -2, asf: 20 } }) }));
    act(a, inventoryActions.setSlot.create({ characterId: 'char', itemId: 'plate', slot: 'armor' }));
    act(a, inventoryActions.setSlot.create({ characterId: 'char', itemId: 'shirt', slot: 'armor' }));
    const loadout = () => inv().loadouts.find((l) => l.id === inv().activeLoadoutId)!;
    assert.equal(loadout().slots.shirt, 'armor');
    assert.equal(loadout().slots.plate, 'carried', 'the plate came off');

    const sword = item('Longsword (Masterwork)');
    act(a, inventoryActions.setSlot.create({ characterId: 'char', itemId: sword.id, slot: 'bothHands' }));
    assert.equal(loadout().slots[sword.id], 'bothHands');

    const pack = item('Backpack');
    act(a, inventoryActions.addItem.create({ characterId: 'char', item: makeItem({ id: 'pouch', name: 'Belt pouch', container: { extradimensional: false, capacity: null }, containerId: pack.id }) }));
    act(a, inventoryActions.moveItem.create({ characterId: 'char', itemId: pack.id, containerId: 'pouch' }));
    assert.ok(a.rejects().includes("Can't put a container inside itself"));
    act(a, inventoryActions.moveItem.create({ characterId: 'char', itemId: sword.id, containerId: 'plate' }));
    assert.ok(a.rejects().includes("Full Plate isn't a container"));

    act(a, inventoryActions.adjust.create({ characterId: 'char', itemId: item('Trail Rations').id, quantity: -2 }));
    assert.equal(item('Trail Rations').quantity, 3);
    act(a, inventoryActions.adjust.create({ characterId: 'char', itemId: item('Trail Rations').id, quantity: -10 }));
    assert.equal(item('Trail Rations').quantity, 0, 'never below zero');

    // A second loadout without the armor: switching loadouts changes AC.
    act(a, inventoryActions.createLoadout.create({ characterId: 'char', loadoutId: 'camp', name: 'Camp', copyFrom: inv().activeLoadoutId }));
    act(a, inventoryActions.setSlot.create({ characterId: 'char', itemId: 'shirt', slot: 'notCarried' }));
    const ac = () => computeCharacterStats(room.currentState.characters.char!).ac.normal.total;
    const campAc = ac();
    act(a, inventoryActions.setActiveLoadout.create({ characterId: 'char', loadoutId: inv().loadouts[0]!.id }));
    assert.equal(ac(), campAc + 4, 'chain shirt worn in the first loadout');
    act(a, inventoryActions.deleteLoadout.create({ characterId: 'char', loadoutId: 'camp' }));
    act(a, inventoryActions.deleteLoadout.create({ characterId: 'char', loadoutId: inv().loadouts[0]!.id }));
    assert.ok(a.rejects().includes('Keep at least one loadout'));
  });

  test('only the owner and GM edit; unshared inventory changes never reach other players', () => {
    const { a, b, act, inv } = setup();
    const before = b.inbox.length;
    act(a, inventoryActions.setCoins.create({ characterId: 'char', coins: { pp: 1, gp: 2, sp: 3, cp: 4 } }));
    assert.deepEqual(inv().coins, { pp: 1, gp: 2, sp: 3, cp: 4 });
    assert.equal(b.inbox.slice(before).filter((m) => m.t === 'action').length, 0);
    act(b, inventoryActions.setCoins.create({ characterId: 'char', coins: { pp: 0, gp: 0, sp: 0, cp: 0 } }));
    assert.ok(b.rejects().includes("You don't control that character"));
  });

  test('lit torch syncs to the linked token; characters without light sources leave a hand-set token light alone', () => {
    const { room, g, a, act } = setup();
    act(g, tokenActions.update.create({ id: 'hero', changes: { light: { bright: 2, dim: 4, color: '#ffffff' } } }));
    act(a, characterSheetActions.syncToken.create({ id: 'char' }));
    assert.deepEqual(room.currentState.tokens.hero!.light, { bright: 2, dim: 4, color: '#ffffff' }, 'no light sources: untouched');

    act(a, inventoryActions.addItem.create({ characterId: 'char', item: makeItem({ id: 'torch', name: 'Torch', light: { bright: 20, dim: 40 } }) }));
    act(a, inventoryActions.setLit.create({ characterId: 'char', itemId: 'torch', lit: true }));
    act(a, characterSheetActions.syncToken.create({ id: 'char' }));
    assert.deepEqual(room.currentState.tokens.hero!.light, { bright: 4, dim: 8, color: '#ffffff' }, '20/40 ft at 5 ft per cell');

    act(a, inventoryActions.setLit.create({ characterId: 'char', itemId: 'torch', lit: false }));
    act(a, characterSheetActions.syncToken.create({ id: 'char' }));
    assert.equal(room.currentState.tokens.hero!.light, null);
  });

  test('loot: take part of a stack, true properties stay GM-only until identified, give it back', () => {
    const { room, g, a, b, act, inv } = setup();
    act(g, lootActions.create.create({ id: 'potions', item: { name: 'Potion of Cure Light Wounds', imageUrl: null, quantity: 3, value: '50 gp', holderId: null, notes: 'Smells of mint' } }));
    act(g, lootActions.setSecret.create({ id: 'potions', secretNotes: 'Actually poison' }));

    act(a, inventoryActions.takeLoot.create({ lootId: 'potions', characterId: 'char', itemId: 'p1', quantity: 1 }));
    const taken = inv().items.find((i) => i.id === 'p1')!;
    assert.equal(taken.value, 50);
    assert.equal(taken.notes, 'Smells of mint');
    assert.equal(taken.lootId, 'potions');
    assert.equal(room.currentState.loot.potions!.quantity, 2);
    assert.equal(redactState(room.currentState, alice).loot.potions!.secretNotes, '', 'still secret');
    assert.ok(!JSON.stringify(redactState(room.currentState, alice).characters).includes('poison'));
    assert.ok(b.inbox.some((m) => m.t === 'action' && m.action.type === 'inventory/takeLoot'), 'Bob sees the loot list change');

    act(a, inventoryActions.takeLoot.create({ lootId: 'potions', characterId: 'char', itemId: 'p2', quantity: 2 }));
    assert.equal(room.currentState.loot.potions!.stowed, true, 'empty: hidden from the Loot list, kept for its secret');
    act(g, lootActions.setIdentified.create({ id: 'potions', identified: true }));
    assert.equal(redactState(room.currentState, alice).loot.potions!.secretNotes, 'Actually poison');

    act(a, inventoryActions.giveToLoot.create({ characterId: 'char', itemId: 'p2', quantity: 2, newLootId: 'unused' }));
    assert.equal(room.currentState.loot.potions!.quantity, 2);
    assert.equal(room.currentState.loot.potions!.stowed, false);
    assert.equal(room.currentState.loot.unused, undefined, 'went back onto its own record');
    assert.ok(!inv().items.some((i) => i.id === 'p2'), 'whole stack left the inventory');

    // Own gear becomes a new loot record Bob receives in full, though he can't see the character.
    act(a, inventoryActions.giveToLoot.create({ characterId: 'char', itemId: inv().items[0]!.id, quantity: 1, newLootId: 'sword' }));
    const msg = b.inbox.findLast((m) => m.t === 'action' && m.action.type === 'inventory/giveToLoot');
    assert.ok(msg && msg.t === 'action' && (msg.action.payload as { loot?: { name: string } }).loot?.name === 'Longsword (Masterwork)');
    assert.equal(room.currentState.loot.sword!.value, '315 gp');
  });

  test('re-import keeps the inventory unless asked to replace it', () => {
    const { a, act, inv } = setup();
    act(a, inventoryActions.addItem.create({ characterId: 'char', item: makeItem({ id: 'rope', name: 'Silk rope' }) }));
    const build = parsePcg(SAMPLE);
    act(a, characterActions.reimport.create({ id: 'char', build, fileName: 'v2.pcg' }));
    assert.ok(inv().items.some((i) => i.id === 'rope'));
    act(a, characterActions.reimport.create({ id: 'char', build, fileName: 'v3.pcg', replaceInventory: true }));
    assert.ok(!inv().items.some((i) => i.id === 'rope'));
    assert.equal(inv().items.length, 3);
  });

  test('v6 -> v7 migration seeds inventories and marks loot unstowed', () => {
    const state = createInitialState('s1');
    const c = character() as Record<string, unknown>;
    delete c.inventory;
    const v6: Record<string, unknown> = {
      ...state,
      schemaVersion: 6,
      characters: { char: c },
      loot: { l1: { id: 'l1', name: 'Gem', imageUrl: null, quantity: 1, value: '', holderId: null, notes: '', identified: false, secretNotes: '', createdBy: 'gm1', createdAt: 1 } },
    };
    const migrated = migrateState(v6);
    assert.equal(migrated.schemaVersion, CURRENT_SCHEMA_VERSION);
    assert.equal(migrated.characters.char!.inventory.items.length, 3);
    assert.equal(migrated.loot.l1!.stowed, false);
  });

  test('zero-quantity items cannot be duplicated via takeLoot or giveToLoot; returning partial stack preserves active loot name', () => {
    const { room, g, a, act, item } = setup();
    act(g, lootActions.create.create({ id: 'emptyLoot', item: { name: 'Empty', imageUrl: null, quantity: 0, value: '', holderId: null, notes: '' } }));
    act(a, inventoryActions.takeLoot.create({ lootId: 'emptyLoot', characterId: 'char', itemId: 'e1', quantity: 1 }));
    assert.ok(a.rejects().includes('None left'));

    act(a, inventoryActions.adjust.create({ characterId: 'char', itemId: item('Trail Rations').id, quantity: -10 }));
    assert.equal(item('Trail Rations').quantity, 0);
    act(a, inventoryActions.giveToLoot.create({ characterId: 'char', itemId: item('Trail Rations').id, quantity: 1, newLootId: 'dupRations' }));
    assert.ok(a.rejects().includes('None in the inventory'));
    assert.equal(room.currentState.loot.dupRations, undefined);

    // Returning a renamed split stack onto an active (unstowed) party stack does not clobber the party stack's name/notes.
    act(g, lootActions.create.create({ id: 'gems', item: { name: 'Ruby', imageUrl: null, quantity: 3, value: '1,500 gp', holderId: null, notes: 'From dragon hoard' } }));
    act(a, inventoryActions.takeLoot.create({ lootId: 'gems', characterId: 'char', itemId: 'g1', quantity: 1 }));
    assert.equal(item('Ruby').value, 1500, 'thousands-separated gp parsed correctly');
    act(a, inventoryActions.updateItem.create({ characterId: 'char', itemId: 'g1', changes: { name: 'Renamed gem', notes: 'Local note' } }));
    act(a, inventoryActions.giveToLoot.create({ characterId: 'char', itemId: 'g1', quantity: 1, newLootId: 'unused2' }));
    assert.equal(room.currentState.loot.gems!.quantity, 3);
    assert.equal(room.currentState.loot.gems!.name, 'Ruby');
    assert.equal(room.currentState.loot.gems!.notes, 'From dragon hoard');
  });

  test('detectGear, sizedDamage, parseGpValue, EQUIPSET:Equipped armor, nested extradimensional weight, and updateItem normalization', () => {
    assert.equal(parseGpValue('2,315 gp'), 2315);
    assert.equal(parseGpValue('12,5 gp'), 12.5);
    assert.equal(parseGpValue('3 gems'), 0);

    assert.equal(detectGear('Wand of Acid Arrow').weapon, null, 'wand of acid arrow is not a weapon');
    assert.ok(detectGear('Wand of Acid Arrow').charges, 'wand still gets charges');
    assert.equal(detectGear('Potion of Resist Acid').weapon, null);
    assert.equal(detectGear('Acid').weapon?.damage, '1d6');

    const comp = detectGear('Composite Longbow (+2 Str)');
    assert.equal(comp.weapon?.strDamage, 'full');
    assert.equal(comp.weapon?.enhancement, 0, '(+2 Str) is not a magic enhancement');
    assert.equal(detectGear('Longbow (Composite)').weapon?.strDamage, 'full');
    assert.equal(detectGear('Shortsword').weapon?.damage, '1d6');
    assert.equal(detectGear('Sword (Short)').weapon?.damage, '1d6');
    assert.equal(detectGear('Crossbow (Light)').weapon?.damage, '1d8');

    assert.equal(sizedDamage('1d8', 'Huge'), '3d6');
    assert.equal(sizedDamage('2d6', 'Huge'), '4d6');
    assert.equal(sizedDamage('1d10', 'Huge'), '3d8');
    assert.equal(sizedDamage('1d8', 'Tiny'), '1d4');

    const eqInv = seedInventory(
      parsePcg(`${SAMPLE}\nEQUIPNAME:Chainmail|OUTPUTORDER:4|COST:150|WT:40|QUANTITY:1.0\nEQUIPSET:Equipped|ID:0.1.3|VALUE:Chainmail|QUANTITY:1.0\n`),
    );
    assert.equal(eqInv.loadouts[0]!.slots[eqInv.items.find((i) => i.name === 'Chainmail')!.id], 'armor');

    // Bag of Holding inside Backpack: anvil inside Bag counts for Bag capacity, not Backpack capacity.
    const c = character();
    const pack = c.inventory.items.find((i) => i.name === 'Backpack')!;
    c.inventory.items.push(
      makeItem({ id: 'boh', name: 'Bag of Holding (Type I)', weight: 15, containerId: pack.id, container: { extradimensional: true, capacity: 250 } }),
      makeItem({ id: 'anvil', name: 'Anvil', weight: 100, containerId: 'boh' }),
    );
    assert.equal(containerContentsWeight(c.inventory, 'boh'), 100);
    assert.equal(containerContentsWeight(c.inventory, pack.id), 5 + 15, '5 lb rations + 15 lb bag, not the 100 lb anvil inside the bag');

    // updateItem clears lit when light becomes null and clamps charges.current <= max.
    const { a, act, item } = setup();
    act(a, inventoryActions.addItem.create({ characterId: 'char', item: makeItem({ id: 't1', name: 'Torch', light: { bright: 20, dim: 40 }, lit: true }) }));
    act(a, inventoryActions.updateItem.create({ characterId: 'char', itemId: 't1', changes: { light: null, charges: { current: 80, max: 50 } } }));
    assert.equal(item('Torch').lit, false);
    assert.deepEqual(item('Torch').charges, { current: 50, max: 50 });
  });

  test('stowed loot records cannot be updated by players or deleted by non-GMs', () => {
    const { room, g, a, b, act } = setup();
    act(b, lootActions.create.create({ id: 'ring', item: { name: 'Strange Ring', imageUrl: null, quantity: 1, value: '', holderId: null, notes: '' } }));
    act(g, lootActions.setSecret.create({ id: 'ring', secretNotes: 'Cursed ring' }));
    act(a, inventoryActions.takeLoot.create({ lootId: 'ring', characterId: 'char', itemId: 'r1', quantity: 1 }));
    assert.equal(room.currentState.loot.ring!.stowed, true);

    act(b, lootActions.update.create({ id: 'ring', changes: { name: 'Tampered' } }));
    assert.ok(b.rejects().includes('Item is stowed in an inventory'));
    assert.equal(room.currentState.loot.ring!.name, 'Strange Ring');

    act(b, lootActions.remove.create({ id: 'ring' }));
    assert.ok(b.rejects().includes('Only the GM can delete a stowed loot record'));
    assert.ok(room.currentState.loot.ring);

    act(g, lootActions.remove.create({ id: 'ring' }));
    assert.equal(room.currentState.loot.ring, undefined);
  });
});
