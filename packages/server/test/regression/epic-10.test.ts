import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import {
  applyAction,
  characterActions,
  characterBioActions,
  characterSheetActions,
  createInitialState,
  CURRENT_SCHEMA_VERSION,
  EMPTY_BIO,
  GameStateSchema,
  migrateState,
  parsePcg,
  redactState,
  type Character,
} from '@vtt/shared';
import { ALICE, assertNoWireLeak, BOB, createRoomFixture, GM_USER, makePcgCharacter, SAMPLE_PCG, withPcgLines, type RoomFixture } from '../helpers/harness';

let fx: RoomFixture | null = null;
afterEach(async () => {
  await fx?.cleanup();
  fx = null;
});

const SECRET = /secretDmNote/;

/** Alice's character with GM notes set by the GM. */
function setup(shared = false) {
  fx = createRoomFixture();
  const { gm, alice, act } = fx;
  act(alice, characterActions.import.create({ character: { ...makePcgCharacter(undefined, { id: 'val' }), shared } }));
  act(gm, characterBioActions.setDmNotes.create({ id: 'val', text: 'secretDmNote: the cult wants him' }));
  assert.deepEqual([...gm.rejects(), ...alice.rejects()], []);
  assert.equal(fx.room.currentState.characters.val!.bio.dmNotes, 'secretDmNote: the cult wants him');
  return fx;
}

describe('[Epic 10] regressions', () => {
  test('v12 -> v13 migration seeds bio and moves GM notes out of the shared build', () => {
    const state = createInitialState('scene1');
    const c = makePcgCharacter(withPcgLines(SAMPLE_PCG), { id: 'x' }) as unknown as Record<string, unknown>;
    delete c.bio;
    // A pre-Epic-10 build still carrying DM notes in the build itself.
    const build = parsePcg(withPcgLines(SAMPLE_PCG, 'CHARACTERDMNOTES:secretDmNote old', 'NOTE:DM Notes|ID:9|PARENTID:-1|VALUE:secretDmNote tree'));
    const migrated = migrateState({ ...state, schemaVersion: 12, characters: { x: { ...c, build } } });
    assert.equal(migrated.schemaVersion, CURRENT_SCHEMA_VERSION);
    const m = migrated.characters.x!;
    assert.equal(m.bio.fields.gender, 'Male');
    assert.equal(m.bio.notes.length, 2);
    assert.match(m.bio.dmNotes, /secretDmNote old[\s\S]*secretDmNote tree/);
    assert.equal(m.build.bio.dmNotes, null);
    assert.doesNotMatch(JSON.stringify(m.build), SECRET);
    assert.doesNotMatch(JSON.stringify(redactState(migrated, ALICE)), SECRET, 'owner snapshot after migration has no GM notes');
  });

  test('schema bounds: note/chronicle counts, unique ids, tree shape and string lengths', () => {
    const base = createInitialState('scene1');
    const withBio = (bio: Partial<Character['bio']>) => ({ ...base, characters: { x: { ...makePcgCharacter(undefined, { id: 'x' }), bio: { ...EMPTY_BIO, ...bio } } } });
    const note = (id: string, parentId: string | null = null) => ({ id, parentId, title: id, body: '' });
    const ok = (bio: Partial<Character['bio']>) => GameStateSchema.safeParse(withBio(bio)).success;
    assert.ok(ok({ notes: Array.from({ length: 200 }, (_, i) => note(`n${i}`)) }));
    assert.ok(!ok({ notes: Array.from({ length: 201 }, (_, i) => note(`n${i}`)) }));
    assert.ok(!ok({ notes: [note('a'), note('a')] }), 'duplicate note id');
    assert.ok(!ok({ notes: [note('a', 'b'), note('b', 'a')] }), 'cycle');
    assert.ok(!ok({ notes: [note('a', 'missing')] }), 'orphan');
    assert.ok(!ok({ notes: [{ ...note('a'), title: '' }] }), 'empty title');
    assert.ok(!ok({ notes: [{ ...note('a'), body: 'x'.repeat(8001) }] }));
    assert.ok(!ok({ dmNotes: 'x'.repeat(10001) }));
    assert.ok(!ok({ fields: { ...EMPTY_BIO.fields, eyes: 'x'.repeat(201) } }));
    assert.ok(!ok({ portraitUrl: 'file:///C:/portrait.png' }));
    const entry = (id: string) => ({ id, campaign: '', scenario: '', date: '', gm: '', party: '', xp: 0, gold: 0, fame: 0, notes: '' });
    assert.ok(ok({ chronicles: Array.from({ length: 200 }, (_, i) => entry(`c${i}`)) }));
    assert.ok(!ok({ chronicles: Array.from({ length: 201 }, (_, i) => entry(`c${i}`)) }));
    assert.ok(!ok({ chronicles: [entry('a'), entry('a')] }));
    assert.ok(!ok({ chronicles: [{ ...entry('a'), xp: -1 }] }));
  });

  test('only the GM can write GM notes; players can’t smuggle them through import, reimport, update or updateRuntime', () => {
    const { room, gm, alice, act } = setup();
    act(alice, characterBioActions.setDmNotes.create({ id: 'val', text: 'mine' }));
    assert.match(alice.rejects()[0]!, /Only the GM/);

    const withDm = { ...makePcgCharacter(undefined, { id: 'v2' }), bio: { ...EMPTY_BIO, dmNotes: 'player wrote this' } };
    act(alice, characterActions.import.create({ character: withDm }));
    assert.match(alice.rejects()[1]!, /Only the GM can add GM notes/);

    const rawBuild = parsePcg(withPcgLines(SAMPLE_PCG, 'CHARACTERDMNOTES:in build'));
    act(alice, characterActions.import.create({ character: { ...makePcgCharacter(undefined, { id: 'v3' }), build: rawBuild } }));
    act(gm, characterActions.import.create({ character: { ...makePcgCharacter(undefined, { id: 'v4', ownerId: null }), build: rawBuild } }));
    act(alice, characterActions.reimport.create({ id: 'val', build: rawBuild, fileName: 'x.pcg' }));
    const treeBuild = parsePcg(withPcgLines(SAMPLE_PCG, 'NOTE:DM Notes|ID:9|PARENTID:-1|VALUE:', 'NOTE:Twist|ID:10|PARENTID:9|VALUE:x'));
    act(gm, characterActions.reimport.create({ id: 'val', build: treeBuild, fileName: 'x.pcg' }));
    assert.equal(alice.rejects().filter((r) => /moved out of the imported build/.test(r)).length, 2);
    assert.equal(gm.rejects().filter((r) => /moved out of the imported build/.test(r)).length, 2);

    act(alice, characterSheetActions.updateRuntime.create({ id: 'val', changes: { bio: { dmNotes: 'x' } } as never }));
    act(alice, characterActions.update.create({ id: 'val', changes: { bio: { dmNotes: 'x' } } as never }));
    act(alice, characterBioActions.updateBio.create({ id: 'val', changes: { dmNotes: 'x' } as never }));
    assert.match(room.currentState.characters.val!.bio.dmNotes, SECRET);
  });

  test('wire privacy: GM notes never reach the owner or other players through any character action', () => {
    const { room, gm, alice, bob, act } = setup();
    const aliceSince = 0;
    const bobSince = 0;
    act(gm, characterBioActions.setDmNotes.create({ id: 'val', text: 'secretDmNote v2' }));
    act(alice, characterActions.update.create({ id: 'val', changes: { name: 'Val' } }));
    act(alice, characterActions.update.create({ id: 'val', changes: { shared: true } })); // full -> Bob
    act(alice, characterActions.update.create({ id: 'val', changes: { shared: false } }));
    act(gm, characterActions.setOwner.create({ id: 'val', ownerId: BOB.id })); // full -> Bob
    act(gm, characterActions.setOwner.create({ id: 'val', ownerId: ALICE.id })); // full -> Alice
    act(gm, characterActions.update.create({ id: 'val', changes: { shared: true } }));
    act(alice, characterBioActions.updateBio.create({ id: 'val', changes: { biography: 'b' } }));
    act(alice, characterBioActions.addNote.create({ id: 'val', note: { id: 'n', parentId: null, title: 'N', body: '' } }));
    act(alice, characterActions.reimport.create({ id: 'val', build: parsePcg(SAMPLE_PCG), fileName: 'v2.pcg', replaceBio: true }));
    // A GM import of a character for Alice that carries GM notes.
    act(gm, characterActions.import.create({ character: { ...makePcgCharacter(undefined, { id: 'npc', ownerId: ALICE.id }), shared: true, bio: { ...EMPTY_BIO, dmNotes: 'secretDmNote npc' } } }));
    assert.deepEqual([...gm.rejects(), ...alice.rejects()], []);

    assertNoWireLeak(alice, aliceSince, SECRET);
    assertNoWireLeak(bob, bobSince, SECRET);
    assert.match(gm.json(), /secretDmNote v2/);
    // Server and GM copies keep the notes through the full-character payloads.
    assert.equal(room.currentState.characters.val!.bio.dmNotes, 'secretDmNote v2');
    assert.equal(room.currentState.characters.npc!.bio.dmNotes, 'secretDmNote npc');
    assert.equal(redactState(room.currentState, GM_USER).characters.val!.bio.dmNotes, 'secretDmNote v2');
    for (const u of [ALICE, BOB]) assert.doesNotMatch(JSON.stringify(redactState(room.currentState, u)), SECRET);
  });

  test('wire privacy: rejoin snapshots blank GM notes for players', () => {
    const { room, alice } = setup(true);
    const since = alice.inbox.length;
    room.leave(alice);
    room.join(alice, ALICE);
    assert.ok(alice.inbox.length > since);
    assertNoWireLeak(alice, since, SECRET);
  });

  test('a GM client applying a full-character payload (dmNotes blanked) keeps its own GM notes', () => {
    const { room, gm, alice, act } = setup();
    const gmView = redactState(room.currentState, GM_USER);
    act(alice, characterActions.update.create({ id: 'val', changes: { shared: true } }));
    const msg = gm.actions().at(-1)!;
    assert.equal(msg.action.type, 'character/update');
    assert.doesNotMatch(JSON.stringify(msg.action), SECRET, 'the full payload carries no GM notes at all');
    const after = applyAction(gmView, msg.action, msg.meta);
    assert.match(after.characters.val!.bio.dmNotes, SECRET);
    assert.equal(after.characters.val!.shared, true);
  });

  test('unshared bio, notes and chronicle never reach Bob', () => {
    const { bob, alice, act } = setup();
    const since = bob.inbox.length;
    act(alice, characterBioActions.updateBio.create({ id: 'val', changes: { description: 'secretBio' } }));
    act(alice, characterBioActions.addNote.create({ id: 'val', note: { id: 'n', parentId: null, title: 'secretBio note', body: '' } }));
    act(alice, characterBioActions.addChronicle.create({ id: 'val', entry: { id: 'c', campaign: 'secretBio', scenario: '', date: '', gm: '', party: '', xp: 0, gold: 0, fame: 0, notes: '' } }));
    assert.equal(bob.inbox.length, since, 'Bob receives nothing at all');
    assertNoWireLeak(bob, since, /secretBio/);
  });
});
