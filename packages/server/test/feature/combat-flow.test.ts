import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import {
  characterActions,
  combatActions,
  createToken,
  newId,
  pf1eTurnActions,
  tokenActions,
} from '@vtt/shared';
import { ALICE, createRoomFixture, makePcgCharacter, SAMPLE_PCG, withPcgLines, type RoomFixture } from '../helpers/harness';

let fx: RoomFixture | null = null;
afterEach(async () => {
  if (fx) {
    await fx.cleanup();
    fx = null;
  }
});

describe('feature: PF1e multi-round combat & action economy', () => {
  test('full encounter lifecycle: initiative, Combat Reflexes AoO, immediate lock, delay, resetTurn, hidden NPCs and new encounter', () => {
    fx = createRoomFixture();
    const { room, gm, alice, bob, act } = fx;

    const samPcg = withPcgLines(
      SAMPLE_PCG.replace('CLASS:Wizard|LEVEL:1', 'CLASS:Samurai|LEVEL:1').replace('CLASSABILITIESLEVEL:Wizard=1', 'CLASSABILITIESLEVEL:Samurai=1'),
      'ABILITY:FEAT|TYPE:NORMAL|CATEGORY:FEAT|KEY:Combat Reflexes',
    );
    const hero = makePcgCharacter(samPcg, { id: 'heroChar', ownerId: ALICE.id });
    act(alice, characterActions.import.create({ character: hero }));
    act(gm, tokenActions.create.create({ token: createToken({ id: 'tHero', sceneId: 'scene1', x: 0, y: 0, ownerIds: [ALICE.id] }) }));
    act(gm, tokenActions.create.create({ token: createToken({ id: 'tGob', sceneId: 'scene1', x: 70, y: 0, name: 'Goblin' }) }));
    act(gm, tokenActions.create.create({ token: createToken({ id: 'tAsn', sceneId: 'scene1', x: 140, y: 0, name: 'Assassin', hidden: true }) }));
    act(alice, characterActions.linkToken.create({ id: 'heroChar', tokenId: 'tHero' }));

    act(gm, combatActions.add.create({ combatant: { id: 'cGob', name: 'Goblin', tokenId: 'tGob', initiative: 25, modifier: 2, hidden: false } }));
    act(gm, combatActions.add.create({ combatant: { id: 'cHero', name: 'Hero', tokenId: 'tHero', initiative: 15, modifier: 0, hidden: false } }));
    act(gm, combatActions.add.create({ combatant: { id: 'cAsn', name: 'Assassin', tokenId: 'tAsn', initiative: 5, modifier: 4, hidden: false } }));
    act(gm, combatActions.start.create({}));

    // Round 1, Goblin's turn: Hero hasn't acted (flat-footed) but has Combat Reflexes (Dex +2 -> 3 AoOs).
    act(alice, pf1eTurnActions.act.create({ actionId: 'g.aoo', combatantId: 'cHero', chatId: newId() }));
    act(alice, pf1eTurnActions.act.create({ actionId: 'g.aoo', combatantId: 'cHero', chatId: newId() }));
    assert.equal(alice.rejects().length, 0);
    // Flat-footed still blocks immediate actions even with Combat Reflexes.
    act(alice, pf1eTurnActions.act.create({ actionId: 'c.samurai.resolute', combatantId: 'cHero', chatId: newId() }));
    assert.ok(alice.rejects().includes('Not while flat-footed'));

    // Goblin ends turn -> Hero's turn (Round 1): fresh turn resets AoOs and clears flat-footed.
    act(gm, combatActions.next.create({}));
    assert.equal(room.currentState.combat.currentId, 'cHero');
    act(alice, pf1eTurnActions.act.create({ actionId: 'g.charge', combatantId: 'cHero', chatId: newId() }));
    act(alice, pf1eTurnActions.act.create({ actionId: 'g.fivefoot', combatantId: 'cHero', chatId: newId() }));
    assert.ok(alice.rejects().includes('Not after moving this turn'));

    // Reset turn restores Hero's full turn.
    act(alice, pf1eTurnActions.resetTurn.create({ combatantId: 'cHero' }));
    const rejectsBefore = alice.rejects().length;
    act(alice, pf1eTurnActions.act.create({ actionId: 'g.attack', combatantId: 'cHero', chatId: newId() }));
    assert.equal(alice.rejects().length, rejectsBefore);

    // Hero ends turn -> Hidden Assassin's turn.
    act(alice, combatActions.next.create({}));
    assert.equal(room.currentState.combat.currentId, 'cAsn');
    const bobBeforeHidden = bob.inbox.length;
    act(gm, pf1eTurnActions.act.create({ actionId: 'g.poison', combatantId: 'cAsn', chatId: newId() }));
    assert.equal(bob.inbox.slice(bobBeforeHidden).filter((m) => m.t === 'action' && m.action.type === 'pf1e/act').length, 0, 'hidden assassin stays invisible to Bob');

    // Off-turn immediate action by Hero locks Round 2 Swift action.
    act(alice, pf1eTurnActions.act.create({ actionId: 'c.samurai.resolute', combatantId: 'cHero', chatId: newId() }));
    act(gm, combatActions.next.create({})); // Round 2, Goblin
    act(gm, combatActions.next.create({})); // Round 2, Hero
    act(alice, pf1eTurnActions.act.create({ actionId: 'c.samurai.challenge', combatantId: 'cHero', chatId: newId() }));
    assert.ok(alice.rejects().some((r) => r.startsWith('Swift action already used')));

    // Hero delays after Assassin (combat/move), passing turn to Assassin.
    act(alice, combatActions.move.create({ id: 'cHero', beforeId: null }));
    assert.equal(room.currentState.combat.currentId, 'cAsn');

    // Ending and restarting combat clears pf1eTurns so Round 1 starts fresh.
    act(gm, combatActions.end.create({ clear: false }));
    assert.deepEqual(room.currentState.pf1eTurns, {});
    act(gm, combatActions.start.create({}));
    const r2 = alice.rejects().length;
    act(gm, combatActions.next.create({})); // Hero's turn in new fight
    act(alice, pf1eTurnActions.act.create({ actionId: 'c.samurai.challenge', combatantId: 'cHero', chatId: newId() }));
    assert.equal(alice.rejects().length, r2, 'swift action is fresh in the new encounter');
  });
});
