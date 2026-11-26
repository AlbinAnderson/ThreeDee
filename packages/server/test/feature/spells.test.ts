import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { characterActions, characterSheetActions, characterSpellcasting, pf1eTurnActions, redactState, spellActions, spellSlotKey, type GameAction } from '@vtt/shared';
import { ALICE, BOB, casterPcg, createRoomFixture, makePcgCharacter, spellLine, type RoomFixture, type TestClient } from '../helpers/harness';

let fx: RoomFixture | null = null;
afterEach(async () => {
  await fx?.cleanup();
  fx = null;
});

const SORCERER = casterPcg({
  classes: ['CLASS:Sorcerer|LEVEL:3|SKILLPOOL:0'],
  stats: { CHA: 16 },
  spells: [spellLine('Burning Hands', 'Sorcerer', 1), spellLine('Magic Missile', 'Sorcerer', 1), spellLine('Ray of Frost', 'Sorcerer', 0)],
});

const WIZARD = casterPcg({
  classes: ['CLASS:Wizard|SUBCLASS:Evoker|LEVEL:3|SKILLPOOL:0'],
  stats: { INT: 16 },
  spells: [
    spellLine('Magic Missile', 'Wizard', 1),
    spellLine('Shield', 'Wizard', 1),
    spellLine('Color Spray', 'Wizard', 1),
    spellLine('Detect Magic', 'Wizard', 0),
    spellLine('Magic Missile', 'Wizard', 1, 'Prepared Spells', 2),
    spellLine('Detect Magic', 'Wizard', 0, 'Prepared Spells'),
  ],
});

const CLERIC = casterPcg({ classes: ['CLASS:Cleric|LEVEL:1|SKILLPOOL:0'], stats: { WIS: 14 }, align: 'NG' });

function setup(pcg: string, id: string, shared = false) {
  fx = createRoomFixture();
  fx.act(fx.alice, characterActions.import.create({ character: { ...makePcgCharacter(pcg, { id }), shared } }));
  return fx;
}

let chatN = 0;
const cast = (fx: RoomFixture, who: TestClient, payload: Omit<Parameters<typeof spellActions.cast.create>[0], 'chatId'>, chatId = `chat-${++chatN}`) =>
  fx.act(who, spellActions.cast.create({ chatId, ...payload }) as GameAction);

describe('[Epic 7] casting spells in a room', () => {
  test('a spontaneous cast spends a slot and posts a server-built spell card; slots run out', () => {
    const f = setup(SORCERER, 'sorc');
    const { room, alice } = f;
    cast(f, alice, { characterId: 'sorc', className: 'Sorcerer', spellName: 'Burning Hands', level: 1 }, 'c1');
    const c = room.currentState.characters.sorc!;
    assert.equal(c.runtime.uses[spellSlotKey('Sorcerer', 1)], 1);
    const msg = room.currentState.chat.find((m) => m.id === 'c1')!;
    assert.equal(msg.card?.title, `${c.name}: Burning Hands`);
    assert.match(msg.card!.subtitle!, /DC 14/);
    assert.equal(msg.card?.area?.kind, 'cone');
    assert.equal(msg.card?.rolls?.[0]?.label, 'Concentration');

    cast(f, alice, { characterId: 'sorc', className: 'Sorcerer', spellName: 'Ray of Frost', level: 0 });
    assert.equal(room.currentState.characters.sorc!.runtime.uses[spellSlotKey('Sorcerer', 0)], undefined, 'cantrips are free');
    for (let i = 0; i < 5; i++) cast(f, alice, { characterId: 'sorc', className: 'Sorcerer', spellName: 'Magic Missile', level: 1 });
    assert.equal(room.currentState.characters.sorc!.runtime.uses[spellSlotKey('Sorcerer', 1)], 6);
    cast(f, alice, { characterId: 'sorc', className: 'Sorcerer', spellName: 'Magic Missile', level: 1 });
    assert.ok(alice.rejects().includes('No 1st-level slots left today'));
  });

  test('slots are a resource: adjust them by hand (clamped) and Rest restores them', () => {
    const { room, alice, act } = setup(SORCERER, 'sorc');
    const key = spellSlotKey('Sorcerer', 1);
    act(alice, pf1eTurnActions.adjustUse.create({ characterId: 'sorc', key, delta: 50 }));
    assert.equal(room.currentState.characters.sorc!.runtime.uses[key], 6);
    act(alice, pf1eTurnActions.adjustUse.create({ characterId: 'sorc', key: spellSlotKey('Sorcerer', 4), delta: 1 }));
    assert.ok(alice.rejects().includes('Unknown resource'));
    act(alice, pf1eTurnActions.resetUses.create({ characterId: 'sorc' }));
    assert.deepEqual(room.currentState.characters.sorc!.runtime.uses, {});
  });

  test('prepared casters: cast from the .pcg list, check off/undo, prepare a new day, Rest un-casts', () => {
    const { room, alice, act } = setup(WIZARD, 'wiz');
    const prepared = () => room.currentState.characters.wiz!.runtime.prepared.Wizard;
    assert.equal(prepared(), undefined, 'still using the file');
    cast(fx!, alice, { characterId: 'wiz', className: 'Wizard', preparedId: 'pcg-0' }, 'mm');
    assert.deepEqual(prepared()?.map((p) => [p.name, p.cast]), [
      ['Magic Missile', true],
      ['Magic Missile', false],
      ['Detect Magic', false],
    ]);
    cast(fx!, alice, { characterId: 'wiz', className: 'Wizard', preparedId: 'pcg-0' });
    assert.ok(alice.rejects().includes('Magic Missile was already cast today'));
    cast(fx!, alice, { characterId: 'wiz', className: 'Wizard', preparedId: 'pcg-2' });
    assert.equal(prepared()?.[2]?.cast, false, 'cantrips are never used up');

    act(alice, spellActions.markPrepared.create({ characterId: 'wiz', className: 'Wizard', preparedId: 'pcg-0', cast: false }));
    assert.equal(prepared()?.[0]?.cast, false);

    act(
      alice,
      spellActions.prepare.create({
        characterId: 'wiz',
        className: 'Wizard',
        spells: [
          { id: 'a', name: 'Color Spray', level: 1, metamagic: [], slot: 'normal' },
          { id: 'b', name: 'Shield', level: 1, metamagic: [], slot: 'normal' },
          { id: 'c', name: 'Magic Missile', level: 1, metamagic: [], slot: 'bonus' },
        ],
      }),
    );
    assert.deepEqual(prepared()?.map((p) => [p.id, p.name, p.slot, p.cast]), [
      ['a', 'Color Spray', 'normal', false],
      ['b', 'Shield', 'normal', false],
      ['c', 'Magic Missile', 'bonus', false],
    ]);
    act(alice, spellActions.prepare.create({ characterId: 'wiz', className: 'Wizard', spells: [{ id: 'x', name: 'Fireball', level: 1, metamagic: [], slot: 'normal' }] }));
    assert.ok(alice.rejects().includes("Fireball isn't in your spellbook"));

    cast(fx!, alice, { characterId: 'wiz', className: 'Wizard', preparedId: 'a' });
    cast(fx!, alice, { characterId: 'wiz', className: 'Wizard', preparedId: 'c' });
    assert.deepEqual(prepared()?.map((p) => p.cast), [true, false, true]);
    act(alice, pf1eTurnActions.resetUses.create({ characterId: 'wiz' }));
    assert.deepEqual(prepared()?.map((p) => p.cast), [false, false, false], 'Rest keeps the list and restores every casting');
  });

  test('clerics convert a prepared spell into a cure spell', () => {
    const { room, alice, act } = setup(CLERIC, 'cl');
    act(
      alice,
      spellActions.prepare.create({
        characterId: 'cl',
        className: 'Cleric',
        spells: [
          { id: 'b', name: 'Bless', level: 1, metamagic: [], slot: 'normal' },
          { id: 'g', name: 'Guidance', level: 0, metamagic: [], slot: 'normal' },
        ],
      }),
    );
    cast(fx!, alice, { characterId: 'cl', className: 'Cleric', preparedId: 'b', convert: 'cure' }, 'cure');
    assert.equal(room.currentState.characters.cl!.runtime.prepared.Cleric![0]!.cast, true);
    const card = room.currentState.chat.find((m) => m.id === 'cure')!.card!;
    assert.match(card.title, /Cure Light Wounds/);
    assert.match(card.text!, /in place of Bless/);
    cast(fx!, alice, { characterId: 'cl', className: 'Cleric', preparedId: 'g', convert: 'cure' });
    assert.ok(alice.rejects().some((r) => /can’t be converted/.test(r)));
  });

  test('only the owner or GM may cast, prepare or check off', () => {
    const { room, alice, bob, gm, act } = setup(WIZARD, 'wiz', true);
    cast(fx!, bob, { characterId: 'wiz', className: 'Wizard', preparedId: 'pcg-0' });
    act(bob, spellActions.markPrepared.create({ characterId: 'wiz', className: 'Wizard', preparedId: 'pcg-0', cast: true }));
    act(bob, spellActions.prepare.create({ characterId: 'wiz', className: 'Wizard', spells: [] }));
    assert.equal(bob.rejects().filter((r) => r === "You don't control that character").length, 3);
    cast(fx!, gm, { characterId: 'wiz', className: 'Wizard', preparedId: 'pcg-1' });
    assert.equal(room.currentState.characters.wiz!.runtime.prepared.Wizard?.[1]?.cast, true, 'the GM runs anyone');
    assert.equal(alice.rejects().length, 0);
  });
});

describe('[Epic 7] spell privacy', () => {
  test('an unshared caster’s public card reaches everyone, but its sheet stays private', () => {
    const f = setup(SORCERER, 'sorc');
    const before = f.bob.inbox.length;
    cast(f, f.alice, { characterId: 'sorc', className: 'Sorcerer', spellName: 'Burning Hands', level: 1 }, 'pub');
    const bobView = redactState(f.room.currentState, BOB);
    assert.ok(bobView.chat.some((m) => m.id === 'pub'));
    assert.equal(bobView.characters.sorc, undefined);
    const delivered = f.bob.inbox.slice(before).filter((m) => m.t === 'action');
    assert.equal(delivered.length, 1);
    assert.doesNotMatch(JSON.stringify(delivered), /"runtime"|"build"/, 'the action carries the card, not the character');
  });

  test('a GM-only cast stays away from players who can’t see the character', () => {
    const f = setup(SORCERER, 'sorc');
    const before = f.bob.inbox.length;
    cast(f, f.alice, { characterId: 'sorc', className: 'Sorcerer', spellName: 'Burning Hands', level: 1, whisper: { mode: 'gm', to: [] } }, 'secret');
    assert.equal(f.bob.inbox.slice(before).filter((m) => m.t === 'action').length, 0);
    assert.ok(redactState(f.room.currentState, f.room.currentState.users.gm1!).chat.some((m) => m.id === 'secret'));
  });

  test('a shared caster’s slot use reaches the party even when the card is GM-only (and the card is redacted)', () => {
    const f = setup(SORCERER, 'sorc', true);
    const before = f.bob.inbox.length;
    cast(f, f.alice, { characterId: 'sorc', className: 'Sorcerer', spellName: 'Burning Hands', level: 1, whisper: { mode: 'gm', to: [] } }, 'gmonly');
    assert.equal(f.bob.inbox.slice(before).filter((m) => m.t === 'action').length, 1, 'Bob sees the sheet, so he gets the slot change');
    const bobView = redactState(f.room.currentState, BOB);
    assert.equal(bobView.characters.sorc!.runtime.uses[spellSlotKey('Sorcerer', 1)], 1);
    assert.ok(!bobView.chat.some((m) => m.id === 'gmonly'));
    assert.ok(redactState(f.room.currentState, ALICE).chat.some((m) => m.id === 'gmonly'));
  });

  test('preparing and checking off reach only people who can see the character', () => {
    const f = setup(WIZARD, 'wiz');
    const before = f.bob.inbox.length;
    f.act(f.alice, spellActions.markPrepared.create({ characterId: 'wiz', className: 'Wizard', preparedId: 'pcg-0', cast: true }));
    f.act(f.alice, spellActions.prepare.create({ characterId: 'wiz', className: 'Wizard', spells: [] }));
    assert.equal(f.bob.inbox.slice(before).filter((m) => m.t === 'action').length, 0);
    assert.equal(f.gm.inbox.filter((m) => m.t === 'action' && m.action.type === 'pf1e/prepareSpells').length, 1);
  });

  test('casting settings on the sheet change the numbers for everyone who sees the character', () => {
    const f = setup(casterPcg({ classes: ['CLASS:Mystic Theurge|LEVEL:2|SKILLPOOL:0'], spells: [spellLine('Bless', 'Mystic Theurge', 1)] }), 'mt');
    f.act(
      f.alice,
      characterSheetActions.updateSheet.create({
        id: 'mt',
        changes: { spellcasting: { 'Mystic Theurge': { model: 'spontaneous', stat: 'WIS', casterLevel: 6, perDay: [null, 3], dcBonus: 0, concentrationBonus: 0 } } },
      }),
    );
    const info = characterSpellcasting(f.room.currentState.characters.mt!)[0]!;
    assert.equal(info.casterLevel, 6);
    cast(f, f.alice, { characterId: 'mt', className: 'Mystic Theurge', spellName: 'Bless', level: 1 });
    assert.equal(f.room.currentState.characters.mt!.runtime.uses[spellSlotKey('Mystic Theurge', 1)], 1);
  });
});
