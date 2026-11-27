import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import {
  characterActions,
  characterBioActions,
  createToken,
  MAX_CHARACTER_NOTES,
  NOTE_MAX_LENGTH,
  notesActions,
  parsePcg,
  redactState,
  tokenActions,
} from '@vtt/shared';
import { ALICE, BOB, createRoomFixture, makePcgCharacter, SAMPLE_PCG, withPcgLines, type RoomFixture } from '../helpers/harness';

let fx: RoomFixture | null = null;
afterEach(async () => {
  await fx?.cleanup();
  fx = null;
});

function setup(shared = false) {
  fx = createRoomFixture();
  fx.act(fx.alice, characterActions.import.create({ character: { ...makePcgCharacter(undefined, { id: 'val' }), shared } }));
  assert.deepEqual(fx.alice.rejects(), []);
  return fx;
}

describe('[Epic 10] feature: bio, portrait, notes tree, chronicle', () => {
  test('bio fields and portrait: owner edits, unshared bio never reaches Bob, sharing delivers it', () => {
    const { room, alice, bob, act } = setup();
    act(alice, characterBioActions.updateBio.create({ id: 'val', changes: { fields: { eyes: 'secretBio green' }, biography: 'secretBio story', portraitUrl: '/assets/abc.png' } }));
    const c = room.currentState.characters.val!;
    assert.equal(c.bio.fields.eyes, 'secretBio green');
    assert.equal(c.bio.fields.hair, 'Brown, Short', 'other fields untouched');
    assert.equal(c.bio.portraitUrl, '/assets/abc.png');
    assert.doesNotMatch(bob.json(), /secretBio/);

    act(bob, characterBioActions.updateBio.create({ id: 'val', changes: { biography: 'hacked' } }));
    assert.match(bob.rejects()[0]!, /don't control/);

    act(alice, characterActions.update.create({ id: 'val', changes: { shared: true } }));
    assert.equal(redactState(room.currentState, BOB).characters.val!.bio.biography, 'secretBio story');
    act(bob, characterBioActions.updateBio.create({ id: 'val', changes: { biography: 'hacked' } }));
    assert.equal(room.currentState.characters.val!.bio.biography, 'secretBio story', 'shared viewers can read but not edit');

    act(alice, characterBioActions.updateBio.create({ id: 'val', changes: { portraitUrl: 'javascript:alert(1)' as never } }));
    assert.match(alice.rejects().at(-1)!, /asset|URL/i);
  });

  test('Use as token image: the owner sets the linked token image from the portrait', () => {
    const { room, gm, alice, act } = setup();
    act(gm, tokenActions.create.create({ token: createToken({ id: 'tVal', sceneId: 'scene1', x: 0, y: 0, ownerIds: [ALICE.id] }) }));
    act(alice, characterActions.linkToken.create({ id: 'val', tokenId: 'tVal' }));
    act(alice, characterBioActions.updateBio.create({ id: 'val', changes: { portraitUrl: '/assets/face.webp' } }));
    act(alice, tokenActions.update.create({ id: 'tVal', changes: { imageUrl: room.currentState.characters.val!.bio.portraitUrl } }));
    assert.deepEqual(alice.rejects(), []);
    assert.equal(room.currentState.tokens.tVal!.imageUrl, '/assets/face.webp');
  });

  test('notes CRUD: add root/child, edit, refuse cycles and unknown parents, delete removes the subtree', () => {
    const { room, alice, act } = setup();
    const notes = () => room.currentState.characters.val!.bio.notes;
    act(alice, characterBioActions.addNote.create({ id: 'val', note: { id: 'r', parentId: null, title: 'Quests', body: '' } }));
    act(alice, characterBioActions.addNote.create({ id: 'val', note: { id: 'k', parentId: 'r', title: 'Find the key', body: 'In the cellar' } }));
    act(alice, characterBioActions.addNote.create({ id: 'val', note: { id: 'g', parentId: 'k', title: 'Grandchild', body: '' } }));
    act(alice, characterBioActions.addNote.create({ id: 'val', note: { id: 'bad', parentId: 'nope', title: 'X', body: '' } }));
    act(alice, characterBioActions.addNote.create({ id: 'val', note: { id: 'r', parentId: null, title: 'Dup', body: '' } }));
    assert.deepEqual(alice.rejects(), ['Parent note not found', 'Note already exists']);

    act(alice, characterBioActions.updateNote.create({ id: 'val', noteId: 'k', changes: { title: 'Find the silver key', body: 'Under the stairs' } }));
    assert.equal(notes().find((n) => n.id === 'k')!.title, 'Find the silver key');
    act(alice, characterBioActions.updateNote.create({ id: 'val', noteId: 'r', changes: { parentId: 'g' } }));
    act(alice, characterBioActions.updateNote.create({ id: 'val', noteId: 'r', changes: { parentId: 'r' } }));
    assert.equal(alice.rejects().length, 4);
    assert.equal(notes().find((n) => n.id === 'r')!.parentId, null);
    act(alice, characterBioActions.updateNote.create({ id: 'val', noteId: 'g', changes: { parentId: 'r' } }));
    assert.equal(notes().find((n) => n.id === 'g')!.parentId, 'r');

    const before = notes().length;
    act(alice, characterBioActions.deleteNote.create({ id: 'val', noteId: 'r' }));
    assert.equal(notes().length, before - 3);
    assert.ok(notes().every((n) => !['r', 'k', 'g'].includes(n.id)));
  });

  test('notes count cap', () => {
    const { room, alice, act } = setup();
    const existing = room.currentState.characters.val!.bio.notes.length;
    for (let i = existing; i < MAX_CHARACTER_NOTES; i++) act(alice, characterBioActions.addNote.create({ id: 'val', note: { id: `n${i}`, parentId: null, title: `N${i}`, body: '' } }));
    assert.deepEqual(alice.rejects(), []);
    act(alice, characterBioActions.addNote.create({ id: 'val', note: { id: 'over', parentId: null, title: 'Over', body: '' } }));
    assert.match(alice.rejects()[0]!, /At most/);
    assert.equal(room.currentState.characters.val!.bio.notes.length, MAX_CHARACTER_NOTES);
  });

  test('copy notes into the private Notepad: appends, stays private, refuses to overflow', () => {
    const { room, alice, bob, act } = setup();
    act(alice, notesActions.set.create({ text: 'My notes' }));
    act(alice, notesActions.append.create({ text: '# secretNote Session Notes\nMet at the Rusty Dragon.' }));
    assert.equal(room.currentState.notes[ALICE.id]!.text, 'My notes\n\n# secretNote Session Notes\nMet at the Rusty Dragon.');
    assert.doesNotMatch(bob.json(), /secretNote/);
    act(alice, notesActions.append.create({ text: 'x'.repeat(NOTE_MAX_LENGTH - 5) }));
    assert.match(alice.rejects()[0]!, /notepad is full/);
    act(alice, notesActions.append.create({ text: '   ' }));
    assert.equal(alice.rejects().length, 2);
  });

  test('chronicle CRUD', () => {
    const { room, alice, bob, act } = setup();
    const list = () => room.currentState.characters.val!.bio.chronicles;
    assert.equal(list().length, 1, 'seeded from CHRONICLEENTRY');
    const entry = { id: 'c2', campaign: 'PFS', scenario: 'secretScenario', date: '2026-11-26', gm: 'Dana', party: '', xp: 1, gold: 512.5, fame: 2, notes: '' };
    act(alice, characterBioActions.addChronicle.create({ id: 'val', entry }));
    act(alice, characterBioActions.updateChronicle.create({ id: 'val', entryId: 'c2', changes: { xp: 3, gold: -20 } }));
    assert.deepEqual(list().find((e) => e.id === 'c2'), { ...entry, xp: 3, gold: -20 });
    act(alice, characterBioActions.updateChronicle.create({ id: 'val', entryId: 'c2', changes: { xp: -5 } }));
    assert.equal(alice.rejects().length, 1, 'negative XP is refused by the schema');
    act(alice, characterBioActions.deleteChronicle.create({ id: 'val', entryId: 'c2' }));
    assert.equal(list().length, 1);
    assert.doesNotMatch(bob.json(), /secretScenario/);
  });

  test('re-import keeps the VTT bio by default; replaceBio reseeds text, notes and chronicle but keeps portrait and GM notes', () => {
    const { room, gm, alice, act } = setup();
    act(alice, characterBioActions.updateBio.create({ id: 'val', changes: { biography: 'Edited here', portraitUrl: '/assets/p.png' } }));
    act(gm, characterBioActions.setDmNotes.create({ id: 'val', text: 'gm secret' }));
    act(alice, characterBioActions.addNote.create({ id: 'val', note: { id: 'mine', parentId: null, title: 'Mine', body: '' } }));
    const leveled = parsePcg(withPcgLines(SAMPLE_PCG.replace('CHARACTERBIO:Born in Andoran', 'CHARACTERBIO:Reborn'), 'NOTE:New|ID:7|PARENTID:-1|VALUE:v'));

    act(alice, characterActions.reimport.create({ id: 'val', build: leveled, fileName: 'v2.pcg' }));
    let c = room.currentState.characters.val!;
    assert.equal(c.bio.biography, 'Edited here');
    assert.ok(c.bio.notes.some((n) => n.id === 'mine'));

    act(alice, characterActions.reimport.create({ id: 'val', build: leveled, fileName: 'v3.pcg', replaceBio: true }));
    c = room.currentState.characters.val!;
    assert.match(c.bio.biography, /^Reborn/);
    assert.equal(c.bio.portraitUrl, '/assets/p.png');
    assert.equal(c.bio.dmNotes, 'gm secret');
    assert.deepEqual(c.bio.notes.map((n) => n.id), ['pcg-0', 'pcg-1', 'pcg-7'], 'ids come from PCGen ids, stable across re-imports');
    assert.deepEqual(alice.rejects(), []);
  });

  test('deleting a character removes its bio with it; bio survives a DB reload', async () => {
    const { room, store, alice, act } = setup();
    act(alice, characterBioActions.updateBio.create({ id: 'val', changes: { description: 'Persisted' } }));
    await room.flush({ autoSnapshot: false });
    const loaded = await store.load('main');
    assert.equal(loaded?.characters.val?.bio.description, 'Persisted');
    act(alice, characterActions.remove.create({ id: 'val' }));
    assert.equal(room.currentState.characters.val, undefined);
    act(alice, characterBioActions.addNote.create({ id: 'val', note: { id: 'z', parentId: null, title: 'Z', body: '' } }));
    assert.match(alice.rejects()[0]!, /not found/);
  });
});
