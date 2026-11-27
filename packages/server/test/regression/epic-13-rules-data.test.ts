import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, test } from 'node:test';
import {
  characterActions,
  createInitialState,
  createToken,
  CURRENT_SCHEMA_VERSION,
  inventoryActions,
  makeItem,
  migrateState,
  newId,
  NO_RULES,
  parsePcg,
  tokenActions,
  type GameAction,
  type InventoryItem,
  type RulesProvider,
} from '@vtt/shared';
import { SqliteRoomStore } from '../../src/persistence/SqliteRoomStore';
import { Room, type Client } from '../../src/rooms/Room';
import { buildRulesPack } from '../../src/rules/buildPack';
import { RulesPackStore } from '../../src/rules/packStore';
import {
  ALICE,
  assertNoWireLeak,
  BOB,
  casterPcg,
  createTestClient,
  GM_USER,
  makePcgCharacter,
  NO_AUTO_SNAPSHOT,
  SAMPLE_PCG,
} from '../helpers/harness';

const cleanups: (() => Promise<void> | void)[] = [];

afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

function buildMiniPack(): RulesPackStore {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vtt-e13-reg-'));
  cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
  const inDir = path.join(dir, 'in');
  const outDir = path.join(dir, 'out');
  fs.mkdirSync(inDir, { recursive: true });
  fs.writeFileSync(
    path.join(inDir, 'core.pcc'),
    [
      'CAMPAIGN:Core Rulebook',
      'KEY:Core Rulebook',
      'SOURCELONG:Core Rulebook',
      'SOURCESHORT:CR',
      'PUBNAMELONG:Paizo Inc.',
      'BOOKTYPE:Core Rules',
      'CLASS:classes.lst',
      'ABILITY:abilities.lst',
      'EQUIPMENT:equip.lst',
    ].join('\n'),
  );
  fs.writeFileSync(
    path.join(inDir, 'classes.lst'),
    'CLASS:Arcane Trickster\tHD:6\tTYPE:PC.Prestige\tBONUS:COMBAT|BASEAB|classlevel("APPLIEDAS=NONEPIC")/2\tBONUS:SAVE|BASE.Reflex,BASE.Will|(classlevel("APPLIEDAS=NONEPIC")+1)/2\nCLASS:Arcane Trickster\tSTARTSKILLPTS:4\tCSKILL:Stealth|Disable Device',
  );
  fs.writeFileSync(
    path.join(inDir, 'abilities.lst'),
    'Deft Dodger\tKEY:Trait ~ Deft Dodger\tCATEGORY:Special Ability\tTYPE:Trait\tBONUS:SAVE|Reflex|1|TYPE=Trait\nImproved Init Proxy\tKEY:Trait ~ Quickstep\tCATEGORY:Special Ability\tTYPE:Trait\tBONUS:COMBAT|INITIATIVE|3|TYPE=Trait',
  );
  fs.writeFileSync(
    path.join(inDir, 'equip.lst'),
    'Cloak of Resistance +2\tKEY:Cloak of Resistance +2\tTYPE:Magic.Wondrous.Shoulders\tCOST:4000\tWT:1\tBONUS:VAR|FortitudeSave_ResistanceBonus,ReflexSave_ResistanceBonus,WillSave_ResistanceBonus|2|TYPE=Resistance',
  );
  buildRulesPack(inDir, outDir);
  return new RulesPackStore(outDir);
}

function makeRoom(initialRules: RulesProvider) {
  let activeRules: RulesProvider = initialRules;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vtt-e13-room-'));
  const store = new SqliteRoomStore(path.join(dir, 'vtt.db'));
  const room = new Room('main', createInitialState('scene1'), store, NO_AUTO_SNAPSHOT, () => activeRules);
  const gm = createTestClient();
  const alice = createTestClient();
  const bob = createTestClient();
  room.join(gm, GM_USER);
  room.join(alice, ALICE);
  room.join(bob, BOB);
  const act = (c: Client, action: GameAction) => room.handleClientAction(c, newId(), action);
  cleanups.push(async () => {
    await room.flush({ autoSnapshot: false });
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return {
    room,
    gm,
    alice,
    bob,
    act,
    setRules: (r: RulesProvider) => {
      activeRules = r;
    },
  };
}

describe('[Epic 13] schema migration, security guards & wire privacy regressions', () => {
  test('v14 -> v15 migration backfills rulesData and inventory.items[].bonuses on all characters', () => {
    const state = createInitialState('s1');
    const c = makePcgCharacter(SAMPLE_PCG, { id: 'c1' });
    c.inventory.items.push(makeItem({ id: 'i99', name: 'Torch' }));
    const rawChar = structuredClone(c) as unknown as Record<string, unknown>;
    delete rawChar.rulesData;
    const rawInv = rawChar.inventory as { items: Record<string, unknown>[] };
    for (const item of rawInv.items) delete item.bonuses;

    const migrated = migrateState({ ...state, schemaVersion: 14, characters: { c1: rawChar } });
    assert.equal(migrated.schemaVersion, CURRENT_SCHEMA_VERSION);
    assert.deepEqual(migrated.characters.c1!.rulesData, { classes: {}, race: null, bonuses: [], spellSchools: {} });
    assert.ok(migrated.characters.c1!.inventory.items.length > 0);
    for (const item of migrated.characters.c1!.inventory.items) {
      assert.deepEqual(item.bonuses, []);
    }
  });

  test('rejects client-forged rulesData / item.bonuses on import and inventory/addItem, while server prepare() populates them', () => {
    const { room, alice, act } = makeRoom(buildMiniPack());

    // Forged rulesData on import must be rejected.
    const forgedRules = makePcgCharacter(SAMPLE_PCG, { id: 'bad1' });
    forgedRules.rulesData.bonuses.push({ id: 'hack:0', source: 'Hack', target: 'ac', value: 50, type: 'untyped' });
    act(alice, characterActions.import.create({ character: forgedRules }));
    assert.match(alice.rejects().at(-1) ?? '', /rules data/i);

    // Forged item.bonuses on import must be rejected.
    const forgedItem = makePcgCharacter(SAMPLE_PCG, { id: 'bad2' });
    forgedItem.inventory.items.push(makeItem({ id: 'h1', name: 'Ring', bonuses: [{ target: 'ac', value: 50, type: 'deflection' }] }));
    act(alice, characterActions.import.create({ character: forgedItem }));
    assert.match(alice.rejects().at(-1) ?? '', /item bonuses/i);

    // Clean import succeeds and server prepare() populates rulesData & equipment bonuses.
    const pcg = casterPcg({
      classes: ['CLASS:Arcane Trickster|LEVEL:2|SKILLPOOL:0'],
      extra: ['ABILITY:Special Ability|TYPE:NORMAL|CATEGORY:Special Ability|KEY:Trait ~ Deft Dodger', 'EQUIPNAME:Cloak of Resistance +2|OUTPUTORDER:1|COST:4000|WT:1.0|QUANTITY:1.0'],
    });
    const clean = makePcgCharacter(pcg, { id: 'ok1' });
    act(alice, characterActions.import.create({ character: clean }));
    assert.equal(room.currentState.characters.ok1?.rulesData.classes.arcanetrickster?.prestige, true);
    assert.ok(room.currentState.characters.ok1?.rulesData.bonuses.some((b) => b.source === 'Deft Dodger'));
    const cloak = room.currentState.characters.ok1?.inventory.items.find((i) => i.name === 'Cloak of Resistance +2');
    assert.deepEqual(cloak?.bonuses, [{ target: 'saves', value: 2, type: 'resistance' }]);

    // inventory/addItem rejects non-empty bonuses.
    act(
      alice,
      inventoryActions.addItem.create({
        characterId: 'ok1',
        item: makeItem({ id: 'forged', name: 'Super Ring', bonuses: [{ target: 'ac', value: 20, type: 'deflection' }] }),
      }),
    );
    assert.match(alice.rejects().at(-1) ?? '', /item bonuses/i);

    // inventory/updateItem cannot inject bonuses (omitted from ItemChangesSchema).
    const plain = makeItem({ id: 'plain1', name: 'Plain Ring' });
    act(alice, inventoryActions.addItem.create({ characterId: 'ok1', item: plain }));
    act(
      alice,
      inventoryActions.updateItem.create({
        characterId: 'ok1',
        itemId: 'plain1',
        changes: { name: 'Shiny Ring', bonuses: [{ target: 'ac', value: 20, type: 'deflection' }] } as unknown as Partial<InventoryItem>,
      }),
    );
    const updated = room.currentState.characters.ok1!.inventory.items.find((i) => i.id === 'plain1')!;
    assert.equal(updated.name, 'Shiny Ring');
    assert.deepEqual(updated.bonuses, []);
  });

  test('reimport recomputes rulesData when loaded and never leaks unshared build on linked-token sync', () => {
    const { room, gm, alice, bob, act } = makeRoom(buildMiniPack());

    const c = makePcgCharacter(casterPcg({ classes: ['CLASS:Fighter|LEVEL:1|SKILLPOOL:0'] }), { id: 'priv1' });
    c.shared = false;
    act(alice, characterActions.import.create({ character: c }));
    const tok = createToken({ id: 't1', sceneId: 'scene1', x: 2, y: 2, ownerIds: [ALICE.id] });
    act(gm, tokenActions.create.create({ token: tok }));
    act(alice, characterActions.linkToken.create({ id: 'priv1', tokenId: 't1' }));

    // Reimport an unshared character with a secret character name/story AND a new initiative-raising trait
    // so linked-token sync triggers for everyone while private character build MUST NOT leak to Bob!
    const sinceBob = bob.inbox.length;
    const upgradedPcg = casterPcg({
      classes: ['CLASS:Fighter|LEVEL:1|SKILLPOOL:0'],
      extra: ['CHARACTERNAME:TopSecretSpyName', 'ABILITY:Special Ability|TYPE:NORMAL|CATEGORY:Special Ability|KEY:Trait ~ Quickstep'],
    });
    act(alice, characterActions.reimport.create({ id: 'priv1', build: parsePcg(upgradedPcg), fileName: 'secret-spy.pcg' }));

    assert.ok(room.currentState.characters.priv1!.rulesData.bonuses.some((b) => b.source === 'Improved Init Proxy'));
    // Bob must NOT see the unshared character's build, filename, or traits over the wire!
    assertNoWireLeak(bob, sinceBob, /secret-spy|Quickstep|Improved Init Proxy/);
    // Meanwhile Bob's view of the room still receives the updated public token sync.
    assert.equal(room.currentState.tokens.t1!.name, 'TopSecretSpyName');
  });

  test('reimport without a loaded rules pack (NO_RULES) preserves existing rulesData, and hidden linked tokens never leak to players', () => {
    const { room, gm, alice, bob, act, setRules } = makeRoom(buildMiniPack());

    const pcg = casterPcg({ classes: ['CLASS:Arcane Trickster|LEVEL:2|SKILLPOOL:0'] });
    act(alice, characterActions.import.create({ character: makePcgCharacter(pcg, { id: 'keep1' }) }));
    assert.equal(room.currentState.characters.keep1!.rulesData.classes.arcanetrickster?.prestige, true);

    // Server has no pack loaded (NO_RULES) -> reimport must NOT wipe existing rulesData.
    setRules(NO_RULES);
    act(alice, characterActions.reimport.create({ id: 'keep1', build: parsePcg(pcg), fileName: 'same.pcg' }));
    assert.equal(room.currentState.characters.keep1!.rulesData.classes.arcanetrickster?.prestige, true);

    // Hidden GM-owned NPC token linked to an unshared character must send ZERO wire messages to non-GM players on reimport!
    setRules(buildMiniPack());
    const npc = makePcgCharacter(casterPcg({ classes: ['CLASS:Fighter|LEVEL:1|SKILLPOOL:0'] }), { id: 'npc1', ownerId: null });
    npc.shared = false;
    act(gm, characterActions.import.create({ character: npc }));
    const hiddenTok = createToken({ id: 'htok', sceneId: 'scene1', x: 5, y: 5, hidden: true, ownerIds: [] });
    act(gm, tokenActions.create.create({ token: hiddenTok }));
    act(gm, characterActions.linkToken.create({ id: 'npc1', tokenId: 'htok' }));

    const sinceBob = bob.inbox.length;
    const bossPcg = casterPcg({
      classes: ['CLASS:Fighter|LEVEL:1|SKILLPOOL:0'],
      extra: ['CHARACTERNAME:HiddenBossLich', 'ABILITY:Special Ability|TYPE:NORMAL|CATEGORY:Special Ability|KEY:Trait ~ Quickstep'],
    });
    act(gm, characterActions.reimport.create({ id: 'npc1', build: parsePcg(bossPcg), fileName: 'boss.pcg' }));
    assertNoWireLeak(bob, sinceBob, /HiddenBossLich|htok|boss\.pcg/);
    assert.equal(bob.inbox.length, sinceBob, 'non-GM player receives zero wire messages for hidden-token reimport');
  });
});
