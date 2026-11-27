import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, test } from 'node:test';
import {
  characterActions,
  createInitialState,
  identifyDc,
  inventoryActions,
  lootActions,
  monsterToCharacter,
  monsterToken,
  rulesActions,
  type ServerMessage,
} from '@vtt/shared';
import { Room } from '../../src/rooms/Room';
import { handleRequest } from '../../src/rpc';
import { AonFetcher } from '../../src/rules/aon';
import { buildRulesPack } from '../../src/rules/buildPack';
import { createRulesPackStore } from '../../src/rules/packStore';
import { SqliteRoomStore } from '../../src/persistence/SqliteRoomStore';
import { ALICE, BOB, createTestClient, GM_USER, makePcgCharacter, SAMPLE_PCG, type TestClient } from '../helpers/harness';

const tmpDirs: string[] = [];
const cleanups: (() => Promise<void>)[] = [];

function makeTmp(prefix: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

afterEach(async () => {
  for (const fn of cleanups.splice(0)) await fn();
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function buildMiniPack() {
  const dir = makeTmp('epic11-feat-');
  const pcg = path.join(dir, 'pcg');
  const out = path.join(dir, 'pack');
  fs.mkdirSync(pcg, { recursive: true });
  fs.writeFileSync(
    path.join(pcg, 'cr.pcc'),
    ['CAMPAIGN:Core Rulebook', 'KEY:Core Rulebook', 'SOURCELONG:Core Rulebook', 'SOURCESHORT:CR', 'PUBNAMELONG:Paizo', 'EQUIPMENT:e.lst', 'SPELL:s.lst'].join('\n'),
  );
  fs.writeFileSync(
    path.join(pcg, 'e.lst'),
    [
      'Longsword\tKEY:Longsword\tTYPE:Weapon.Martial.Melee.OneHanded\tCOST:15\tWT:4\tDAMAGE:1d8\tCRITRANGE:2\tCRITMULT:x2\tWIELD:OneHanded\tSOURCEPAGE:p.143\tDESC:Steel sword.',
      'Ruby\tKEY:Ruby\tTYPE:Goods.Gem\tCOST:100\tWT:0\tSOURCEPAGE:p.158\tDESC:A precious gem.',
      'Cloak of Resistance +1\tKEY:Cloak +1\tTYPE:Magic.Wondrous\tCOST:1000\tWT:1\tQUALITY:Slot|shoulders\tQUALITY:Caster Level|5\tQUALITY:Aura|faint abjuration\tSOURCEPAGE:p.506\tDESC:+1 resistance bonus on saves.',
    ].join('\n'),
  );
  fs.writeFileSync(
    path.join(pcg, 's.lst'),
    'Fireball\tSCHOOL:Evocation\tCLASSES:Wizard=3\tTARGETAREA:20-ft.-radius spread\tSAVEINFO:Reflex half\tSPELLRES:Yes\tSOURCEPAGE:p.283\tDESC:Boom.',
  );
  fs.writeFileSync(
    path.join(pcg, 'uc.pcc'),
    ['CAMPAIGN:Ultimate Combat', 'KEY:Ultimate Combat', 'SOURCELONG:Ultimate Combat', 'SOURCESHORT:UC', 'PUBNAMELONG:Paizo', 'EQUIPMENT:uc.lst'].join('\n'),
  );
  fs.writeFileSync(path.join(pcg, 'uc.lst'), 'Katana\tKEY:Katana\tTYPE:Weapon.Exotic.Melee.OneHanded\tCOST:50\tWT:6\tDAMAGE:1d8\tCRITRANGE:3\tCRITMULT:x2\tWIELD:OneHanded\tDESC:Curved blade.');
  buildRulesPack(pcg, out);
  return { dir, rulesStore: createRulesPackStore(out) };
}

function makeRoomWithRules() {
  const { dir, rulesStore } = buildMiniPack();
  const store = new SqliteRoomStore(path.join(dir, 'vtt.db'));
  const room = new Room('r1', createInitialState('scene1'), store, undefined, () => rulesStore);
  const gm = createTestClient();
  const alice = createTestClient();
  const bob = createTestClient();
  room.join(gm, GM_USER);
  room.join(alice, ALICE);
  room.join(bob, BOB);
  let seq = 1;
  const act = (c: TestClient, action: Parameters<Room['handleClientAction']>[2]) => room.handleClientAction(c, `c${seq++}`, action);
  cleanups.push(async () => {
    await room.flush();
    store.close();
  });
  return { dir, room, rulesStore, gm, alice, bob, act };
}

async function callRpc(client: TestClient, op: string, args: unknown, svc: Parameters<typeof handleRequest>[4]) {
  const before = client.inbox.length;
  await handleRequest(client, 'req1', op, args, svc);
  const msg = client.inbox.slice(before).find((m): m is Extract<ServerMessage, { t: 'response' }> => m.t === 'response');
  assert.ok(msg, `Expected RPC response for ${op}`);
  return msg;
}

describe('[Epic 11] rules catalog, shopping, treasure & AoN feature flows', () => {
  test('catalog search respects allowedSources, shopping buys with change and sells at 50%/100%', async () => {
    const { dir, room, rulesStore, gm, alice, act } = makeRoomWithRules();
    const svc = { rulesStore, aonFetcher: new AonFetcher({ cacheDir: path.join(dir, 'aon') }) };

    // GM restricts room to Core Rulebook only
    act(gm, rulesActions.setAllowedSources.create({ allowedSources: ['Core Rulebook'] }));
    assert.deepEqual(gm.rejects(), []);

    const aliceSearch = await callRpc(alice, 'rules.search', { kind: 'equipment', q: 'Katana' }, svc);
    assert.equal(aliceSearch.ok, true);
    assert.equal((aliceSearch.data as unknown[]).length, 0, 'Katana from Ultimate Combat hidden by allowedSources');

    // Import Alice's character (Longsword gets enriched from pack!)
    act(alice, characterActions.import.create({ character: makePcgCharacter(SAMPLE_PCG, { id: 'val', ownerId: ALICE.id }) }));
    assert.deepEqual(alice.rejects(), []);
    const val = room.currentState.characters.val!;
    const ls = val.inventory.items.find((i) => /longsword/i.test(i.name));
    assert.equal(ls?.ruleKey, 'Longsword');

    // Give Alice 500 gp and buy a Masterwork Longsword (315 gp) -> 185 gp left
    act(alice, inventoryActions.setCoins.create({ characterId: 'val', coins: { pp: 0, gp: 500, sp: 0, cp: 0 } }));
    act(
      alice,
      inventoryActions.buyItem.create({
        characterId: 'val',
        itemId: 'bought1',
        quantity: 1,
        ruleKey: 'Longsword',
        mods: { masterwork: true, material: 'none', enhancement: 0 },
      }),
    );
    assert.deepEqual(alice.rejects(), []);
    assert.equal(room.currentState.characters.val!.inventory.coins.gp, 185);
    const bought = room.currentState.characters.val!.inventory.items.find((i) => i.id === 'bought1')!;
    assert.equal(bought.name, 'Masterwork Longsword');
    assert.equal(bought.value, 315);

    // Buying disallowed Ultimate Combat Katana rejected for player
    act(alice, inventoryActions.buyItem.create({ characterId: 'val', itemId: 'k1', quantity: 1, ruleKey: 'Katana' }));
    assert.match(alice.rejects()[0]!, /isn't allowed/);

    // Buying unaffordable Cloak of Resistance +1 (1000 gp) rejected
    act(alice, inventoryActions.buyItem.create({ characterId: 'val', itemId: 'c1', quantity: 1, ruleKey: 'Cloak +1' }));
    assert.match(alice.rejects()[1]!, /Not enough coin/);

    // Buy Ruby (trade good, 100 gp) and sell it at 100% (100 gp), then sell Masterwork Longsword at 50% (157.5 gp)
    act(alice, inventoryActions.buyItem.create({ characterId: 'val', itemId: 'gem1', quantity: 1, ruleKey: 'Ruby' }));
    assert.equal(room.currentState.characters.val!.inventory.coins.gp, 85);
    act(alice, inventoryActions.sellItem.create({ characterId: 'val', itemId: 'gem1', quantity: 1 }));
    assert.equal(room.currentState.characters.val!.inventory.coins.gp, 185);
    act(alice, inventoryActions.sellItem.create({ characterId: 'val', itemId: 'bought1', quantity: 1 }));
    assert.equal(room.currentState.characters.val!.inventory.coins.gp, 342);
    assert.equal(room.currentState.characters.val!.inventory.coins.sp, 5);
  });

  test('GM treasure roll -> unidentified drop -> detect magic (CL/DC) -> identify updates inventory too', async () => {
    const { dir, room, rulesStore, gm, alice, act } = makeRoomWithRules();
    const svc = { rulesStore, aonFetcher: new AonFetcher({ cacheDir: path.join(dir, 'aon') }) };

    act(alice, characterActions.import.create({ character: makePcgCharacter(SAMPLE_PCG, { id: 'val', ownerId: ALICE.id }) }));
    const rolled = await callRpc(gm, 'rules.rollTreasure', { band: 'minor', type: 'wondrous', count: 1 }, svc);
    assert.equal(rolled.ok, true);
    const hit = (rolled.data as { items: { loot: { item: any; secret: any }; cl: number }[] }).items[0]!;
    assert.equal(hit.cl, 5);
    assert.equal(identifyDc(hit.cl), 20);

    act(gm, lootActions.createTreasure.create({ id: 'tr1', item: hit.loot.item, secret: hit.loot.secret }));
    // Alice takes the unidentified cloak into her inventory; she cannot sell it before identifying!
    act(alice, inventoryActions.takeLoot.create({ lootId: 'tr1', characterId: 'val', itemId: 'inv-tr1', quantity: 1 }));
    act(alice, inventoryActions.sellItem.create({ characterId: 'val', itemId: 'inv-tr1', quantity: 1 }));
    assert.match(alice.rejects()[0]!, /Identify this item before selling/);

    // GM reveals magic aura (CL 5 -> DC 20), then identifies it
    act(gm, lootActions.setDetected.create({ id: 'tr1', detected: true }));
    assert.equal(room.currentState.loot.tr1!.magicDetected, true);
    act(gm, lootActions.setIdentified.create({ id: 'tr1', identified: true }));
    const invItem = room.currentState.characters.val!.inventory.items.find((i) => i.id === 'inv-tr1')!;
    assert.equal(invItem.name, 'Cloak of Resistance +1');
    assert.equal(invItem.value, 1000);
  });

  test('on-demand AoN fetch (cached) -> saveCustom & monster spawn', async () => {
    const { dir, room, rulesStore, gm, act } = makeRoomWithRules();
    let fetchCount = 0;
    const mockFetch = async (url: string) => {
      fetchCount++;
      if (url.includes('MonsterDisplay')) {
        return new Response(
          `<h2 class="title">Orc CR 1/3</h2><b>XP</b> 135<br/>CE Medium humanoid<br/><b>Init</b> +0; <b>Senses</b> darkvision 60 ft.<h3 class="framing">Defense</h3><b>AC</b> 13, touch 10, flat-footed 13<br/><b>hp</b> 6 (1d10+1)<br/><b>Fort</b> +3, <b>Ref</b> +0, <b>Will</b> -1<h3 class="framing">Offense</h3><b>Speed</b> 30 ft.<br/><b>Melee</b> falchion +5 (2d4+4/18-20)<h3 class="framing">Statistics</h3><b>Str</b> 17, <b>Dex</b> 11, <b>Con</b> 12, <b>Int</b> 7, <b>Wis</b> 8, <b>Cha</b> 6<br/><b>Base Atk</b> +1; <b>CMB</b> +4; <b>CMD</b> 14`,
          { status: 200 },
        );
      }
      return new Response(
        `<h1 class="title">Boots of Elvenkind</h1><b>Source</b> <i>Core Rulebook pg. 502</i><br/><b>CL</b> 5th; <b>Slot</b> feet; <b>Price</b> 2,500 gp; <b>Weight</b> 1 lb.<h3 class="framing">Description</h3>+5 competence bonus on Acrobatics.`,
        { status: 200 },
      );
    };
    const svc = { rulesStore, aonFetcher: new AonFetcher({ cacheDir: path.join(dir, 'aon'), fetchFn: mockFetch, minIntervalMs: 0 }) };

    // First fetch hits mockFetch; second hits disk cache!
    const r1 = await callRpc(gm, 'rules.fetchAon', { kind: 'wondrous', name: 'Boots of Elvenkind' }, svc);
    assert.equal(r1.ok, true);
    assert.equal((r1.data as { cached: boolean }).cached, false);
    const r2 = await callRpc(gm, 'rules.fetchAon', { kind: 'wondrous', name: 'Boots of Elvenkind' }, svc);
    assert.equal(r2.ok, true);
    assert.equal((r2.data as { cached: boolean }).cached, true);
    assert.equal(fetchCount, 1);

    const draft = (r1.data as { draft: { kind: 'rule'; rule: any } }).draft.rule;
    act(gm, rulesActions.saveCustom.create({ rule: { ...draft, id: 'cr1', gmOnly: false, createdAt: 1 } }));
    assert.equal(room.currentState.customRules.cr1?.name, 'Boots of Elvenkind');

    // Monster fetch -> spawn GM-only NPC + hidden token
    const mRes = await callRpc(gm, 'rules.fetchAon', { kind: 'monster', name: 'Orc' }, svc);
    assert.equal(mRes.ok, true);
    const mDraft = (mRes.data as { monster: any }).monster;
    const npc = { ...monsterToCharacter(mDraft, { id: 'orc1', now: 1, importedBy: GM_USER.id }), tokenId: 'tOrc1' };
    const tok = monsterToken(mDraft, { id: 'tOrc1', sceneId: 'scene1', x: 70, y: 70, unitsPerCell: 5 });
    act(gm, rulesActions.spawnMonster.create({ character: npc, token: tok }));
    assert.deepEqual(gm.rejects(), []);
    assert.equal(room.currentState.characters.orc1?.name, 'Orc');
    assert.equal(room.currentState.tokens.tOrc1?.hidden, true);
  });
});
