import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import {
  buffActions,
  characterActions,
  combatActions,
  computeCharacterStats,
  createToken,
  lookupPreset,
  presetBuff,
  redactState,
  tokenActions,
  type Buff,
} from '@vtt/shared';
import { ALICE, BOB, createRoomFixture, GM_USER, makePcgCharacter, type RoomFixture } from '../helpers/harness';

let fx: RoomFixture | null = null;
afterEach(async () => {
  await fx?.cleanup();
  fx = null;
});

const buff = (id: string, presetId: string, roundsLeft: number | null = null): Buff => {
  const c = makePcgCharacter();
  return { ...presetBuff(c, lookupPreset(presetId)!, undefined, { mod: () => 0 }, id), roundsLeft };
};

/** Alice's character "hero" (optionally shared) linked to her token "tHero"; a goblin token for the GM. */
function setup(opts: { shared?: boolean; link?: boolean } = {}) {
  fx = createRoomFixture();
  const { gm, alice, act } = fx;
  act(alice, characterActions.import.create({ character: { ...makePcgCharacter(undefined, { id: 'hero' }), shared: !!opts.shared } }));
  act(gm, tokenActions.create.create({ token: createToken({ id: 'tHero', sceneId: 'scene1', x: 0, y: 0, name: 'Hero', ownerIds: [ALICE.id] }) }));
  act(gm, tokenActions.create.create({ token: createToken({ id: 'tGob', sceneId: 'scene1', x: 70, y: 0, name: 'Goblin' }) }));
  if (opts.link !== false) act(alice, characterActions.linkToken.create({ id: 'hero', tokenId: 'tHero' }));
  return fx;
}

function startCombat(f: RoomFixture) {
  f.act(f.gm, combatActions.add.create({ combatant: { id: 'cHero', name: 'Hero', tokenId: 'tHero', initiative: 20, modifier: 0, hidden: false } }));
  f.act(f.gm, combatActions.add.create({ combatant: { id: 'cGob', name: 'Goblin', tokenId: 'tGob', initiative: 10, modifier: 0, hidden: false } }));
  f.act(f.gm, combatActions.start.create({}));
}

describe('[Epic 8] buffs in a room', () => {
  test('add, switch off/on, edit and remove a buff; the numbers follow', () => {
    const { room, alice, act } = setup();
    const hero = () => room.currentState.characters.hero!;
    const base = computeCharacterStats(hero()).attacks[0]!.attack.total;
    act(alice, buffActions.add.create({ characterId: 'hero', buff: buff('b1', 'heroism') }));
    assert.equal(computeCharacterStats(hero()).attacks[0]!.attack.total, base + 2);
    act(alice, buffActions.update.create({ characterId: 'hero', buffId: 'b1', changes: { active: false } }));
    assert.equal(computeCharacterStats(hero()).attacks[0]!.attack.total, base);
    act(alice, buffActions.update.create({ characterId: 'hero', buffId: 'b1', changes: { active: true, effects: [{ target: 'attack', value: 3, type: 'morale' }] } }));
    assert.equal(computeCharacterStats(hero()).attacks[0]!.attack.total, base + 3);
    act(alice, buffActions.add.create({ characterId: 'hero', buff: buff('b1', 'bless') }));
    assert.ok(alice.rejects().includes('Buff already exists'));
    act(alice, buffActions.remove.create({ characterId: 'hero', buffId: 'b1' }));
    assert.deepEqual(hero().runtime.buffs, []);
  });

  test('only the owner or GM may change buffs; an unshared character’s buffs never reach other players', () => {
    const { room, alice, bob, gm, act } = setup();
    const before = bob.inbox.length;
    act(alice, buffActions.add.create({ characterId: 'hero', buff: buff('b1', 'bless') }));
    act(gm, buffActions.update.create({ characterId: 'hero', buffId: 'b1', changes: { roundsLeft: 5 } }));
    act(bob, buffActions.remove.create({ characterId: 'hero', buffId: 'b1' }));
    assert.ok(bob.rejects().includes("You don't control that character"));
    assert.equal(bob.inbox.slice(before).filter((m) => m.t === 'action').length, 0);
    assert.equal(room.currentState.characters.hero!.runtime.buffs[0]!.roundsLeft, 5);
  });
});

describe('[Epic 8] conditions follow the token', () => {
  test('token markers drive a linked character’s condition penalties; linking copies them', () => {
    const { room, alice, act } = setup({ link: false });
    act(alice, tokenActions.update.create({ id: 'tHero', changes: { conditions: ['Shaken'] } }));
    assert.deepEqual(room.currentState.characters.hero!.runtime.conditions, [], 'not linked yet');
    const base = computeCharacterStats(room.currentState.characters.hero!).saves.will.total;
    act(alice, characterActions.linkToken.create({ id: 'hero', tokenId: 'tHero' }));
    assert.deepEqual(room.currentState.characters.hero!.runtime.conditions, ['Shaken']);
    assert.equal(computeCharacterStats(room.currentState.characters.hero!).saves.will.total, base - 2);
    act(alice, tokenActions.update.create({ id: 'tHero', changes: { conditions: ['Shaken', 'Sickened'] } }));
    assert.equal(computeCharacterStats(room.currentState.characters.hero!).saves.will.total, base - 4);
    act(alice, tokenActions.update.create({ id: 'tHero', changes: { conditions: [] } }));
    assert.equal(computeCharacterStats(room.currentState.characters.hero!).saves.will.total, base);
  });

  test('a character without a token keeps its own conditions; a linked one must use its token', () => {
    const { room, alice, act } = setup({ link: false });
    act(alice, buffActions.setConditions.create({ characterId: 'hero', conditions: ['Fatigued', 'Fatigued'] }));
    assert.deepEqual(room.currentState.characters.hero!.runtime.conditions, ['Fatigued']);
    act(alice, characterActions.linkToken.create({ id: 'hero', tokenId: 'tHero' }));
    assert.deepEqual(room.currentState.characters.hero!.runtime.conditions, [], 'the token has none');
    act(alice, buffActions.setConditions.create({ characterId: 'hero', conditions: ['Prone'] }));
    assert.ok(alice.rejects().some((r) => /change them on the token/.test(r)));
  });
});

describe('[Epic 8] round countdowns', () => {
  test('token condition timers count down on that token’s turn and end the condition (and its penalty)', () => {
    const f = setup();
    const { room, gm, alice, act } = f;
    act(alice, tokenActions.update.create({ id: 'tHero', changes: { conditions: ['Shaken', 'Prone'], conditionRounds: { Shaken: 2 } } }));
    startCombat(f);
    const token = () => room.currentState.tokens.tHero!;
    act(gm, combatActions.next.create({})); // goblin's turn: hero's timers don't move
    assert.equal(token().conditionRounds.Shaken, 2);
    act(gm, combatActions.next.create({})); // round 2, hero's turn
    assert.equal(token().conditionRounds.Shaken, 1);
    act(gm, combatActions.next.create({}));
    act(gm, combatActions.next.create({})); // round 3, hero's turn: Shaken ends
    assert.deepEqual(token().conditions, ['Prone']);
    assert.deepEqual(token().conditionRounds, {});
    assert.deepEqual(room.currentState.characters.hero!.runtime.conditions, ['Prone'], 'the linked character follows');
    const notice = room.currentState.chat.find((m) => m.userId === 'system')!;
    assert.match(notice.text, /: Shaken ended$/);
    assert.deepEqual(notice.whisper, { mode: 'whisper', to: [ALICE.id, GM_USER.id] });
    assert.ok(!redactState(room.currentState, BOB).chat.some((m) => m.userId === 'system'), 'other players don’t see the notice');
  });

  test('buff timers count down on the character’s turn; at 0 the buff switches off and the owner and GM are told', () => {
    const f = setup({ shared: true });
    const { room, gm, alice, act } = f;
    act(alice, buffActions.add.create({ characterId: 'hero', buff: buff('b1', 'haste', 2) }));
    act(alice, buffActions.add.create({ characterId: 'hero', buff: buff('b2', 'bless') }));
    startCombat(f);
    const buffs = () => room.currentState.characters.hero!.runtime.buffs;
    act(gm, combatActions.next.create({}));
    assert.equal(buffs()[0]!.roundsLeft, 2);
    act(gm, combatActions.next.create({}));
    assert.equal(buffs()[0]!.roundsLeft, 1);
    act(gm, combatActions.prev.create({}));
    act(gm, combatActions.next.create({}));
    assert.equal(buffs()[0]!.roundsLeft, 1, 'going back and forward again counts again only on a real turn start');
    act(gm, combatActions.next.create({}));
    act(gm, combatActions.next.create({}));
    assert.equal(buffs()[0]!.active, false);
    assert.equal(buffs()[0]!.roundsLeft, null);
    assert.equal(buffs()[1]!.active, true, 'untimed buffs stay on');
    const notice = room.currentState.chat.find((m) => m.userId === 'system' && /Haste ended/.test(m.text))!;
    assert.ok(notice);
    // Bob can see the shared sheet (and its buff switching off) but not the private notice.
    const bobView = redactState(room.currentState, BOB);
    assert.equal(bobView.characters.hero!.runtime.buffs[0]!.active, false);
    assert.ok(!bobView.chat.some((m) => m.id === notice.id));
  });

  test('a character not in the turn order counts down once per round', () => {
    const f = setup({ link: false });
    const { room, gm, alice, act } = f;
    act(alice, buffActions.add.create({ characterId: 'hero', buff: buff('b1', 'bless', 1) }));
    startCombat(f);
    act(gm, combatActions.next.create({}));
    assert.equal(room.currentState.characters.hero!.runtime.buffs[0]!.active, true);
    act(gm, combatActions.next.create({})); // new round
    assert.equal(room.currentState.characters.hero!.runtime.buffs[0]!.active, false);
  });
});
