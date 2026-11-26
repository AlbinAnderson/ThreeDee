import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import {
  audioActions,
  chatActions,
  createScene,
  createToken,
  drawingActions,
  fogActions,
  lightActions,
  lootActions,
  macroActions,
  newId,
  notesActions,
  redactState,
  sceneActions,
  templateActions,
  tokenActions,
  wallActions,
} from '@vtt/shared';
import { ALICE, BOB, createRoomFixture, createTestClient, GM_USER, type RoomFixture } from '../helpers/harness';

let fx: RoomFixture | null = null;
afterEach(async () => {
  if (fx) {
    await fx.cleanup();
    fx = null;
  }
});

describe('feature: table play (scenes, fog, lights, drawings, notes, macros, audio, loot)', () => {
  test('scenes, fog of war, placed lights and walls enforce GM permissions and scene cleanup', () => {
    fx = createRoomFixture();
    const { room, gm, alice, act } = fx;

    const s2 = createScene('scene2', 'Dungeon');
    act(alice, sceneActions.create.create({ scene: s2 }));
    assert.ok(alice.rejects().length === 1, 'players cannot create scenes');
    act(gm, sceneActions.create.create({ scene: s2 }));
    act(gm, sceneActions.activate.create({ id: 'scene2' }));
    assert.equal(room.currentState.activeSceneId, 'scene2');

    // Fog of war
    act(alice, fogActions.setEnabled.create({ sceneId: 'scene2', enabled: true }));
    assert.equal(alice.rejects().length, 2);
    act(gm, fogActions.setEnabled.create({ sceneId: 'scene2', enabled: true }));
    act(gm, fogActions.add.create({ sceneId: 'scene2', op: { id: 'op1', mode: 'reveal', shape: 'rect', points: [0, 0, 100, 100], width: 10 } }));
    assert.equal(room.currentState.scenes.scene2!.fog.ops.length, 1);
    act(gm, fogActions.undo.create({ sceneId: 'scene2' }));
    assert.equal(room.currentState.scenes.scene2!.fog.ops.length, 0);
    act(gm, fogActions.reset.create({ sceneId: 'scene2', to: 'revealed', opId: 'opAll' }));
    assert.equal(room.currentState.scenes.scene2!.fog.ops[0]!.shape, 'all');

    // Placed lights & wall clearing
    act(gm, lightActions.add.create({ light: { id: 'l1', sceneId: 'scene2', x: 70, y: 70, bright: 4, dim: 8, color: '#ffcc88' } }));
    act(gm, wallActions.add.create({ walls: [{ id: 'w1', sceneId: 'scene2', points: [0, 0, 70, 0], door: 'closed' }] }));
    act(gm, wallActions.clearScene.create({ sceneId: 'scene2', lights: true }));
    assert.equal(Object.keys(room.currentState.walls).length, 0);
    assert.equal(Object.keys(room.currentState.lights).length, 0);

    // Deleting active scene removes its tokens and falls back to remaining scene.
    act(gm, tokenActions.create.create({ token: createToken({ id: 't2', sceneId: 'scene2', x: 0, y: 0 }) }));
    act(gm, sceneActions.remove.create({ id: 'scene2' }));
    assert.equal(room.currentState.tokens.t2, undefined);
    assert.equal(room.currentState.activeSceneId, 'scene1');
  });

  test('drawings & templates respect authorship and clear rules', () => {
    fx = createRoomFixture();
    const { room, gm, alice, bob, act } = fx;

    act(alice, drawingActions.create.create({ drawing: { id: 'd1', sceneId: 'scene1', authorId: ALICE.id, shape: 'line', points: [0, 0, 70, 70], color: '#00ff00', width: 4, fill: false } }));
    act(bob, drawingActions.create.create({ drawing: { id: 'd2', sceneId: 'scene1', authorId: BOB.id, shape: 'rect', points: [0, 0, 70, 70], color: '#0000ff', width: 4, fill: false } }));
    act(alice, templateActions.create.create({ template: { id: 'tpl1', sceneId: 'scene1', authorId: ALICE.id, kind: 'circle', x: 70, y: 70, size: 2, angle: 0, coneAngle: 90, width: 1, color: '#ff0000' } }));

    // Bob cannot delete Alice's drawing or clear everyone's drawings.
    act(bob, drawingActions.remove.create({ id: 'd1' }));
    assert.ok(bob.rejects().some((r) => r.includes('only erase your own')));
    act(bob, drawingActions.clear.create({ sceneId: 'scene1' }));
    assert.ok(bob.rejects().some((r) => r.includes('Only the GM')));

    // Alice clearing her own removes her drawing and template, leaving Bob's.
    act(alice, drawingActions.clear.create({ sceneId: 'scene1', authorId: ALICE.id }));
    assert.equal(room.currentState.drawings.d1, undefined);
    assert.equal(room.currentState.templates.tpl1, undefined);
    assert.ok(room.currentState.drawings.d2);

    act(gm, drawingActions.clear.create({ sceneId: 'scene1' }));
    assert.equal(Object.keys(room.currentState.drawings).length, 0);
  });

  test('private player notes, saved roll macros, jukebox audio and loot secrets work end-to-end', () => {
    fx = createRoomFixture();
    const { room, gm, alice, bob, act } = fx;

    // Notes: private to author + GM
    act(alice, notesActions.set.create({ text: 'Alice secret plan' }));
    assert.ok(gm.json().includes('Alice secret plan'));
    assert.ok(!bob.json().includes('Alice secret plan'));
    assert.equal(redactState(room.currentState, BOB).notes[ALICE.id], undefined);
    assert.equal(redactState(room.currentState, GM_USER).notes[ALICE.id]?.text, 'Alice secret plan');

    // Macros: formula validation & ownership
    act(alice, macroActions.create.create({ macro: { id: 'm1', ownerId: ALICE.id, name: 'Bad', formula: '0d6' } }));
    assert.ok(alice.rejects().some((r) => r.includes('Formula:')));
    act(alice, macroActions.create.create({ macro: { id: 'm2', ownerId: ALICE.id, name: 'Longsword', formula: '1d20+6' } }));
    act(bob, macroActions.remove.create({ id: 'm2' }));
    assert.ok(bob.rejects().includes('Not your saved roll'));
    act(alice, macroActions.update.create({ id: 'm2', changes: { formula: '1d20+7' } }));
    assert.equal(room.currentState.macros.m2!.formula, '1d20+7');

    // Audio: GM only
    act(alice, audioActions.add.create({ track: { id: 'a1', name: 'Tavern', url: '/assets/t.mp3', volume: 0.5, loop: true, startedAt: null, createdAt: 1 } }));
    assert.equal(alice.rejects().length, 2);
    act(gm, audioActions.add.create({ track: { id: 'a1', name: 'Tavern', url: '/assets/t.mp3', volume: 0.5, loop: true, startedAt: null, createdAt: 1 } }));
    act(gm, audioActions.play.create({ id: 'a1' }));
    assert.ok(typeof room.currentState.audio.a1!.startedAt === 'number');
    act(gm, audioActions.stop.create({ id: 'a1' }));
    assert.equal(room.currentState.audio.a1!.startedAt, null);

    // Loot identification reveals secretNotes to all players on demand.
    act(gm, lootActions.create.create({ id: 'loot1', item: { name: 'Ornate Ring', imageUrl: null, quantity: 1, value: '2,000 gp', holderId: null, notes: 'Gold band' } }));
    act(gm, lootActions.setSecret.create({ id: 'loot1', secretNotes: 'Ring of Protection +1' }));
    assert.ok(!alice.json().includes('Ring of Protection +1'));
    act(gm, lootActions.setIdentified.create({ id: 'loot1', identified: true }));
    assert.ok(alice.json().includes('Ring of Protection +1'));

    // Chat clear is GM-only
    act(alice, chatActions.send.create({ id: newId(), text: 'hello' }));
    act(alice, chatActions.clear.create({}));
    assert.equal(room.currentState.chat.length, 1);
    const late = createTestClient();
    room.join(late, { id: 'late', name: 'Late', role: 'player', color: '#888888' });
    assert.ok(late.json().includes('Ring of Protection +1'));
    act(gm, chatActions.clear.create({}));
    assert.equal(room.currentState.chat.length, 0);
  });
});
