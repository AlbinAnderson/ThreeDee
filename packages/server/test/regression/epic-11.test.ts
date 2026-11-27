import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, test } from 'node:test';
import {
  createInitialState,
  CURRENT_SCHEMA_VERSION,
  GameStateSchema,
  lootActions,
  migrateState,
  monsterToCharacter,
  monsterToken,
  parseAonMonsterHtml,
  redactState,
  rulesActions,
  type ServerMessage,
} from '@vtt/shared';
import { handleRequest } from '../../src/rpc';
import { AonFetcher } from '../../src/rules/aon';
import { createRulesPackStore } from '../../src/rules/packStore';
import { ALICE, assertNoWireLeak, BOB, createRoomFixture, GM_USER, makePcgCharacter, type RoomFixture } from '../helpers/harness';

let fx: RoomFixture | null = null;
const tmpDirs: string[] = [];

afterEach(async () => {
  await fx?.cleanup();
  fx = null;
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function makeTmp(prefix: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

describe('[Epic 11] regressions, SSRF & wire privacy', () => {
  test('v13 -> v14 migration adds rules, customRules, loot true fields, statAttacks and item ruleKey/tradeGood', () => {
    const base = createInitialState('scene1') as unknown as Record<string, unknown>;
    delete base.rules;
    delete base.customRules;
    const oldChar = makePcgCharacter(undefined, { id: 'c1' }) as unknown as Record<string, unknown>;
    delete (oldChar.sheet as Record<string, unknown>).statAttacks;
    for (const item of (oldChar.inventory as { items: Record<string, unknown>[] }).items) {
      delete item.tradeGood;
      delete item.ruleKey;
    }
    const migrated = migrateState({
      ...base,
      schemaVersion: 13,
      characters: { c1: oldChar },
      loot: {
        l1: { id: 'l1', name: 'Ring', imageUrl: null, quantity: 1, value: '', holderId: null, identified: false, notes: '', secretNotes: 'Secret', stowed: false, createdBy: 'gm', createdAt: 1 },
      },
    });
    assert.equal(migrated.schemaVersion, CURRENT_SCHEMA_VERSION);
    assert.deepEqual(migrated.rules, { allowedSources: null });
    assert.deepEqual(migrated.customRules, {});
    assert.equal(migrated.loot.l1!.trueName, '');
    assert.equal(migrated.loot.l1!.cl, null);
    assert.equal(migrated.loot.l1!.magicDetected, false);
    assert.deepEqual(migrated.characters.c1!.sheet.statAttacks, []);
    assert.equal(GameStateSchema.safeParse(migrated).success, true);
  });

  test('SSRF, redirect blocking, size cap and rate limiting on AonFetcher', async () => {
    const cacheDir = makeTmp('aon-ssrf-');
    let calls = 0;
    let clock = 10_000;
    const fetcher = new AonFetcher({
      cacheDir,
      now: () => clock,
      minIntervalMs: 1500,
      maxPerMinute: 2,
      maxBytes: 200,
      fetchFn: async (url) => {
        calls++;
        if (url.includes('RedirectEvil')) return new Response('', { status: 302, headers: { location: 'https://169.254.169.254/secret' } });
        if (url.includes('TooBig')) return new Response('x'.repeat(500), { status: 200 });
        return new Response('<h1 class="title">Ok</h1><b>Source</b> <i>CR pg. 1</i><h3 class="framing">Description</h3>Hi', { status: 200 });
      },
    });

    await assert.rejects(() => fetcher.lookup({ url: 'https://evil.example/SpellDisplay.aspx?ItemName=X' }), /Only https:\/\/www\.aonprd\.com/);
    await assert.rejects(() => fetcher.lookup({ url: 'http://www.aonprd.com/SpellDisplay.aspx?ItemName=X' }), /Only https:\/\/www\.aonprd\.com/);
    assert.equal(calls, 0);

    await assert.rejects(() => fetcher.lookup({ url: 'https://www.aonprd.com/SpellDisplay.aspx?ItemName=RedirectEvil' }), /Blocked redirect/);
    clock += 2000;
    await assert.rejects(() => fetcher.lookup({ url: 'https://www.aonprd.com/SpellDisplay.aspx?ItemName=TooBig' }), /maximum size/);
    clock += 2000;
    // Per-minute cap (2 live calls already happened in last 60s)
    await assert.rejects(() => fetcher.lookup({ url: 'https://www.aonprd.com/SpellDisplay.aspx?ItemName=OneMore' }), /rate limit/i);
  });

  test('GM-only authorization enforced on rules actions and GM RPCs', async () => {
    fx = createRoomFixture();
    const { gm, alice, act } = fx;
    const svc = { rulesStore: createRulesPackStore(makeTmp('empty-pack-')), aonFetcher: new AonFetcher({ cacheDir: makeTmp('empty-aon-') }) };

    act(alice, rulesActions.setAllowedSources.create({ allowedSources: ['Core Rulebook'] }));
    act(alice, rulesActions.saveCustom.create({ rule: { id: 'r1', kind: 'feat', name: 'X', source: '', aonUrl: null, text: '', fields: {}, cost: null, weight: null, cl: null, slot: null, weapon: null, armor: null, gmOnly: false, createdAt: 1 } }));
    assert.equal(alice.rejects().length, 2);

    for (const op of ['rules.rollTreasure', 'rules.fetchAon']) {
      const before = alice.inbox.length;
      await handleRequest(alice, 'r', op, {}, svc);
      const res = alice.inbox.slice(before).find((m): m is Extract<ServerMessage, { t: 'response' }> => m.t === 'response');
      assert.equal(res?.ok, false);
      assert.match(res!.error, /Only the GM/);
    }
    assert.deepEqual(gm.rejects(), []);
  });

  test('wire privacy: unidentified treasure, gmOnly custom rules and GM-only spawned monsters never leak to players', () => {
    fx = createRoomFixture();
    const { room, gm, alice, bob, act } = fx;
    const aliceSince = alice.inbox.length;
    const bobSince = bob.inbox.length;

    // 1. Unidentified treasure with secret true name/value/notes/CL
    act(
      gm,
      lootActions.createTreasure.create({
        id: 't1',
        item: { name: 'Unidentified ring', imageUrl: null, quantity: 1, value: '', holderId: null, notes: '' },
        secret: { trueName: 'SecretRingOfWishes', secretValue: '120,000 gp', secretNotes: 'SecretWishProp', cl: 20 },
      }),
    );
    // 2. Detect magic reveals CL only, never trueName/secretValue/secretNotes
    act(gm, lootActions.setDetected.create({ id: 't1', detected: true }));
    // 3. GM-only custom rule (and converting public -> gmOnly drops it from players without leaking new secret)
    act(
      gm,
      rulesActions.saveCustom.create({
        rule: { id: 'crSecret', kind: 'equipment', name: 'SecretArtifact', source: 'GM', aonUrl: null, text: 'SecretArtifactText', fields: {}, cost: 999, weight: 1, cl: 15, slot: null, weapon: null, armor: null, gmOnly: true, createdAt: 1 },
      }),
    );
    // 4. GM-only spawned monster + hidden token
    const m = parseAonMonsterHtml('<h2 class="title">SecretShadowDragon CR 9</h2><b>hp</b> 100 (10d12+30)<br/><b>AC</b> 22, touch 10, flat-footed 22');
    const npc = { ...monsterToCharacter(m, { id: 'm1', now: 1, importedBy: GM_USER.id }), tokenId: 'tm1' };
    const tok = monsterToken(m, { id: 'tm1', sceneId: 'scene1', x: 70, y: 70, unitsPerCell: 5 });
    act(gm, rulesActions.spawnMonster.create({ character: npc, token: tok }));

    assert.deepEqual(gm.rejects(), []);
    const SECRET = /SecretRingOfWishes|120,000 gp|SecretWishProp|SecretArtifact|SecretShadowDragon|tm1/;
    assertNoWireLeak(alice, aliceSince, SECRET);
    assertNoWireLeak(bob, bobSince, SECRET);

    for (const u of [ALICE, BOB]) {
      const snap = redactState(room.currentState, u);
      assert.doesNotMatch(JSON.stringify({ loot: snap.loot, customRules: snap.customRules, characters: snap.characters }), SECRET);
      assert.equal(snap.loot.t1!.cl, 20); // Detect magic revealed CL only!
      assert.equal(snap.customRules.crSecret, undefined);
      assert.equal(snap.characters.m1, undefined);
    }
  });
});
