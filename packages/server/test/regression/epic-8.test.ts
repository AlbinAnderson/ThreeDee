import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import {
  applyAction,
  buffActions,
  characterActions,
  characterSheetActions,
  combatActions,
  computeCharacterStats,
  createInitialState,
  createToken,
  CURRENT_SCHEMA_VERSION,
  GameStateSchema,
  IdSchema,
  lookupPreset,
  migrateState,
  presetBuff,
  redactState,
  tokenActions,
  type GameState,
  type User,
} from '@vtt/shared';
import { ALICE, BOB, casterPcg, createRoomFixture, makePcgCharacter, type RoomFixture } from '../helpers/harness';

let fx: RoomFixture | null = null;
afterEach(async () => {
  await fx?.cleanup();
  fx = null;
});

const haste = (id: string, roundsLeft: number) => ({ ...presetBuff(makePcgCharacter(), lookupPreset('haste')!, undefined, { mod: () => 0 }, id), roundsLeft });

describe('[Epic 8] regressions', () => {
  test('v10 -> v11 migration: buffs, conditions copied from a linked token, token timers, combat ticks', () => {
    const state = createInitialState('scene1') as unknown as Record<string, unknown> & { tokens: Record<string, unknown>; combat: Record<string, unknown> };
    const token = createToken({ id: 't1', sceneId: 'scene1', x: 0, y: 0, conditions: ['Shaken'] }) as unknown as Record<string, unknown>;
    delete token.conditionRounds;
    const c = { ...makePcgCharacter(undefined, { id: 'x' }), tokenId: 't1' } as unknown as { runtime: Record<string, unknown> };
    delete c.runtime.buffs;
    delete c.runtime.conditions;
    const combat = { ...state.combat };
    delete combat.ticks;
    const migrated = migrateState({ ...state, schemaVersion: 10, tokens: { t1: token }, characters: { x: c }, combat });
    assert.equal(migrated.schemaVersion, CURRENT_SCHEMA_VERSION);
    assert.deepEqual(migrated.tokens.t1!.conditionRounds, {});
    assert.deepEqual(migrated.characters.x!.runtime.conditions, ['Shaken']);
    assert.deepEqual(migrated.characters.x!.runtime.buffs, []);
    assert.deepEqual(migrated.combat.ticks, { round: 0, ids: [] });
  });

  test('character/updateRuntime can’t write buffs or conditions (they have their own checked actions)', () => {
    fx = createRoomFixture();
    const { room, alice, act } = fx;
    act(alice, characterActions.import.create({ character: makePcgCharacter(undefined, { id: 'hero' }) }));
    act(alice, characterSheetActions.updateRuntime.create({ id: 'hero', changes: { buffs: [haste('b1', 3)], conditions: ['Prone'] } as never }));
    assert.deepEqual(room.currentState.characters.hero!.runtime.buffs, []);
    assert.deepEqual(room.currentState.characters.hero!.runtime.conditions, []);
  });

  test('a token keeps timers only for conditions it has', () => {
    fx = createRoomFixture();
    const { room, gm, act } = fx;
    act(gm, tokenActions.create.create({ token: createToken({ id: 't1', sceneId: 'scene1', x: 0, y: 0 }) }));
    act(gm, tokenActions.update.create({ id: 't1', changes: { conditions: ['Shaken', 'Prone'], conditionRounds: { Shaken: 3, Prone: 2, Dazed: 4 } } }));
    assert.deepEqual(room.currentState.tokens.t1!.conditionRounds, { Shaken: 3, Prone: 2 });
    act(gm, tokenActions.update.create({ id: 't1', changes: { conditions: ['Prone'] } }));
    assert.deepEqual(room.currentState.tokens.t1!.conditionRounds, { Prone: 2 });
  });

  test('starting combat doesn’t tick; prev/next doesn’t tick twice; ending combat resets', () => {
    fx = createRoomFixture();
    const { room, gm, alice, act } = fx;
    act(alice, characterActions.import.create({ character: makePcgCharacter(undefined, { id: 'hero' }) }));
    act(gm, tokenActions.create.create({ token: createToken({ id: 'tHero', sceneId: 'scene1', x: 0, y: 0, ownerIds: [ALICE.id] }) }));
    act(gm, tokenActions.create.create({ token: createToken({ id: 'tGob', sceneId: 'scene1', x: 70, y: 0 }) }));
    act(alice, characterActions.linkToken.create({ id: 'hero', tokenId: 'tHero' }));
    act(alice, buffActions.add.create({ characterId: 'hero', buff: haste('b1', 5) }));
    act(gm, combatActions.add.create({ combatant: { id: 'cHero', name: 'Hero', tokenId: 'tHero', initiative: 20, modifier: 0, hidden: false } }));
    act(gm, combatActions.add.create({ combatant: { id: 'cGob', name: 'Goblin', tokenId: 'tGob', initiative: 10, modifier: 0, hidden: false } }));
    act(gm, combatActions.start.create({}));
    const rounds = () => room.currentState.characters.hero!.runtime.buffs[0]!.roundsLeft;
    assert.equal(rounds(), 5, 'the first turn starting with combat doesn’t tick');
    act(gm, combatActions.next.create({}));
    act(gm, combatActions.next.create({}));
    assert.equal(rounds(), 4);
    for (let i = 0; i < 3; i++) {
      act(gm, combatActions.prev.create({}));
      act(gm, combatActions.next.create({}));
    }
    assert.equal(rounds(), 4, 'stepping back and forward three times');
    act(gm, combatActions.end.create({ clear: false }));
    assert.deepEqual(room.currentState.combat.ticks, { round: 0, ids: [] });
  });

  test('turn-start hooks are deterministic: a player’s client replaying combat/next matches the server', () => {
    fx = createRoomFixture();
    const { room, gm, alice, bob, act } = fx;
    // Shared character (Bob sees it) with an expiring buff, and a hidden GM token with an expiring condition.
    act(alice, characterActions.import.create({ character: { ...makePcgCharacter(undefined, { id: 'hero' }), shared: true } }));
    act(gm, tokenActions.create.create({ token: createToken({ id: 'tHero', sceneId: 'scene1', x: 0, y: 0, ownerIds: [ALICE.id] }) }));
    act(gm, tokenActions.create.create({ token: createToken({ id: 'tSpy', sceneId: 'scene1', x: 70, y: 0, hidden: true, conditions: ['Invisible'], conditionRounds: { Invisible: 1 } }) }));
    act(alice, characterActions.linkToken.create({ id: 'hero', tokenId: 'tHero' }));
    act(alice, buffActions.add.create({ characterId: 'hero', buff: haste('b1', 1) }));
    act(gm, combatActions.add.create({ combatant: { id: 'cSpy', name: 'Spy', tokenId: 'tSpy', initiative: 30, modifier: 0, hidden: true } }));
    act(gm, combatActions.add.create({ combatant: { id: 'cHero', name: 'Hero', tokenId: 'tHero', initiative: 20, modifier: 0, hidden: false } }));
    act(gm, combatActions.start.create({}));

    const views = new Map<string, GameState>();
    const users: User[] = [BOB, room.currentState.users[ALICE.id]!];
    const replay = () => {
      for (const u of users) views.set(u.id, redactState(room.currentState, u));
      act(gm, combatActions.next.create({}));
      for (const [client, u] of [
        [bob, BOB],
        [alice, users[1]!],
      ] as const) {
        const msg = client.inbox.filter((m) => m.t === 'action').at(-1)!;
        assert.equal(msg.t === 'action' && msg.action.type, 'combat/next');
        if (msg.t !== 'action') return;
        const local = redactState(applyAction(views.get(u.id)!, msg.action, msg.meta), u);
        assert.deepEqual(local, redactState(room.currentState, u), `${u.name}'s client matches the server`);
      }
    };
    replay(); // Hero's turn: haste ends (notice for Alice + GM)
    replay(); // round 2, Spy's turn: Invisible ends (notice for the GM only)
    const notices = room.currentState.chat.filter((m) => m.userId === 'system');
    assert.equal(notices.length, 2);
    for (const n of notices) assert.equal(IdSchema.safeParse(n.id).success, true);
    assert.ok(GameStateSchema.safeParse(room.currentState).success);
    assert.ok(!redactState(room.currentState, BOB).chat.some((m) => m.userId === 'system'), 'Bob sees neither notice');
    assert.equal(redactState(room.currentState, users[1]!).chat.filter((m) => m.userId === 'system').length, 1, 'Alice only sees her own');
  });

  test('PF1e rules: Unchained Barbarian Raging marker, Helpless drops dodge & ignores Dex damage below -5, Barkskin stacks with Mutagen natural armor', () => {
    // Unchained Barbarian: Raging marker applies Unchained Rage (not Core Rage) and does not double-stack with the active buff.
    const ub = makePcgCharacter(casterPcg({ classes: ['CLASS:Barbarian (Unchained)|LEVEL:1|SKILLPOOL:0'], stats: { STR: 16, CON: 14 } }));
    const ubBase = computeCharacterStats(ub);
    ub.runtime.conditions = ['Raging'];
    const markerOnly = computeCharacterStats(ub);
    assert.equal(markerOnly.abilities.STR.score, ubBase.abilities.STR.score, 'Unchained Rage does not change Str score');
    assert.equal(markerOnly.ac.normal.total, ubBase.ac.normal.total - 2);
    ub.runtime.buffs = [presetBuff(ub, lookupPreset('unchainedRage')!, undefined, { mod: () => 0 }, 'ur1')];
    const both = computeCharacterStats(ub);
    assert.equal(both.ac.normal.total, ubBase.ac.normal.total - 2, 'Raging marker + Rage (unchained) buff do not double-stack');
    assert.equal(both.saves.will.total, ubBase.saves.will.total + 2);

    // Helpless / Paralyzed / Unconscious drops dodge bonuses and caps Dex mod at -5 even with Dex damage.
    const h = makePcgCharacter();
    h.runtime.buffs = [presetBuff(h, lookupPreset('haste')!, undefined, { mod: () => 0 }, 'h1')];
    h.runtime.abilityDamage = { DEX: 4 };
    h.runtime.conditions = ['Paralyzed'];
    const hs = computeCharacterStats(h);
    assert.equal(hs.abilities.DEX.mod, -5, 'Paralyzed Dex mod stays -5 even with ability damage');
    assert.equal(hs.effects.loseDexToAc, true, 'Helpless strips dodge bonuses to AC/CMD');
    assert.ok(!hs.ac.normal.parts.some((p) => p.type === 'dodge' && p.applied), 'Haste dodge AC is lost while paralyzed');

    // Barkskin (enhancement to natural armor) stacks with Mutagen (+2 natural armor), stays off touch AC and CMD, and does not stack with another Barkskin.
    const alch = makePcgCharacter(casterPcg({ classes: ['CLASS:Alchemist|LEVEL:5|SKILLPOOL:0'], stats: { STR: 14, DEX: 14 } }));
    const alchBase = computeCharacterStats(alch);
    alch.runtime.buffs = [
      presetBuff(alch, lookupPreset('mutagen')!, 'STR', { mod: () => 0 }, 'm1'),
      presetBuff(alch, lookupPreset('barkskin')!, '3', { mod: () => 0 }, 'bk1'),
      presetBuff(alch, lookupPreset('barkskin')!, '2', { mod: () => 0 }, 'bk2'),
    ];
    const as = computeCharacterStats(alch);
    assert.equal(as.ac.normal.total, alchBase.ac.normal.total + 2 + 3, 'Mutagen +2 natural stacks with best Barkskin +3 enhancement');
    assert.equal(as.ac.touch.total, alchBase.ac.touch.total, 'neither Mutagen natural nor Barkskin applies to touch AC');
    assert.equal(as.cmd.total, alchBase.cmd.total + 2, 'only Str +4 (+2 mod) from Mutagen raises CMD, not Barkskin');
  });

  test('delaying or removing the current combatant ticks the next combatant’s timers, and token/create prunes orphaned timers', () => {
    fx = createRoomFixture();
    const { room, gm, alice, act } = fx;
    act(gm, tokenActions.create.create({ token: createToken({ id: 'tA', sceneId: 'scene1', x: 0, y: 0, conditions: ['Shaken'], conditionRounds: { Shaken: 2, Dazed: 5 } }) }));
    assert.deepEqual(room.currentState.tokens.tA!.conditionRounds, { Shaken: 2 }, 'token/create prunes timers for absent conditions');
    act(gm, tokenActions.create.create({ token: createToken({ id: 'tB', sceneId: 'scene1', x: 70, y: 0, ownerIds: [ALICE.id], conditions: ['Stunned'], conditionRounds: { Stunned: 2 } }) }));
    act(gm, tokenActions.create.create({ token: createToken({ id: 'tC', sceneId: 'scene1', x: 140, y: 0, conditions: ['Blinded'], conditionRounds: { Blinded: 2 } }) }));
    act(gm, combatActions.add.create({ combatant: { id: 'cA', name: 'A', tokenId: 'tA', initiative: 20, modifier: 0, hidden: false } }));
    act(gm, combatActions.add.create({ combatant: { id: 'cB', name: 'B', tokenId: 'tB', initiative: 15, modifier: 0, hidden: false } }));
    act(gm, combatActions.add.create({ combatant: { id: 'cC', name: 'C', tokenId: 'tC', initiative: 10, modifier: 0, hidden: false } }));
    act(gm, combatActions.start.create({}));

    // A delays to the end -> B's turn starts and B's Stunned ticks 2 -> 1.
    act(gm, combatActions.move.create({ id: 'cA', beforeId: null }));
    assert.equal(room.currentState.combat.currentId, 'cB');
    assert.equal(room.currentState.tokens.tB!.conditionRounds.Stunned, 1);

    // B is removed on its own turn -> C's turn starts and C's Blinded ticks 2 -> 1.
    act(gm, combatActions.remove.create({ id: 'cB' }));
    assert.equal(room.currentState.combat.currentId, 'cC');
    assert.equal(room.currentState.tokens.tC!.conditionRounds.Blinded, 1);
    assert.equal(alice.rejects().length, 0);
  });
});
