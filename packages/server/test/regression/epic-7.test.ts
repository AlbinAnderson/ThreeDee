import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import {
  characterActions,
  characterSheetActions,
  characterSpellcasting,
  ChatCardSchema,
  createInitialState,
  CURRENT_SCHEMA_VERSION,
  migrateState,
  parsePcg,
  planCast,
  spellActions,
  spellCard,
  spellSlotKey,
} from '@vtt/shared';
import { casterPcg, createRoomFixture, makePcgCharacter, spellLine, type RoomFixture } from '../helpers/harness';

let fx: RoomFixture | null = null;
afterEach(async () => {
  await fx?.cleanup();
  fx = null;
});

describe('[Epic 7] regressions', () => {
  test('v9 -> v10 migration adds prepared spells and casting settings', () => {
    const c = makePcgCharacter(undefined, { id: 'x' }) as unknown as { sheet: Record<string, unknown>; runtime: Record<string, unknown> };
    delete c.sheet.spellcasting;
    delete c.runtime.prepared;
    const migrated = migrateState({ ...createInitialState('s1'), schemaVersion: 9, characters: { x: c } });
    assert.equal(migrated.schemaVersion, CURRENT_SCHEMA_VERSION);
    assert.deepEqual(migrated.characters.x!.sheet.spellcasting, {});
    assert.deepEqual(migrated.characters.x!.runtime.prepared, {});
  });

  test('real PCGen metamagic (FEATLIST in a higher slot) keeps the spellbook level for the DC', () => {
    // As PCGen 6 writes it: SpecialWizard.pcg's Combat Book.
    const c = makePcgCharacter(
      casterPcg({
        classes: ['CLASS:Wizard|SUBCLASS:Evoker|LEVEL:8|SKILLPOOL:0'],
        stats: { INT: 18 },
        spells: [
          'SPELLBOOK:Combat Book|TYPE:2',
          spellLine('Magic Missile', 'Wizard', 1),
          spellLine('Magic Missile', 'Wizard', 3, 'Combat Book', 1, '|FEATLIST:[FEAT:Empower Spell]'),
        ],
        extra: ['ABILITY:FEAT|TYPE:NORMAL|CATEGORY:FEAT|KEY:Empower Spell|TYPE:Metamagic.Wizard'],
      }),
    );
    const w = characterSpellcasting(c)[0]!;
    assert.deepEqual(w.prepared.map((p) => [p.name, p.level, p.metamagic]), [['Magic Missile', 3, ['Empower Spell']]]);
    const plan = planCast(c, { className: 'Wizard', preparedId: 'pcg-0' });
    assert.ok(typeof plan !== 'string');
    assert.equal(plan.dcLevel, 1);
    const card = spellCard(c, plan);
    assert.match(card.subtitle, /Wizard 3rd slot \(1st-level spell\)/);
    assert.match(card.text, /Metamagic: Empower Spell/);
  });

  test('Pathfinder .pcg files have no SPELLBASE/CANCASTPERDAY: casting comes from the rules tables', () => {
    const build = parsePcg(casterPcg({ classes: ['CLASS:Oracle|LEVEL:2|SKILLPOOL:0'], stats: { CHA: 17 }, spells: [spellLine('Bless', 'Oracle', 1)] }));
    assert.equal(build.classes[0]!.spellBase, null);
    const o = characterSpellcasting(makePcgCharacter(casterPcg({ classes: ['CLASS:Oracle|LEVEL:2|SKILLPOOL:0'], stats: { CHA: 17 } })))[0]!;
    assert.equal(o.stat, 'CHA');
    assert.equal(o.levels.find((l) => l.level === 1)!.perDay, 4 + 1);
    assert.deepEqual(o.warnings, []);
  });

  test('3e-style files: an unknown class falls back to SPELLBASE and CANCASTPERDAY', () => {
    const c = makePcgCharacter(casterPcg({ classes: ['CLASS:Hexblade|LEVEL:4|SKILLPOOL:0|SPELLBASE:CHA|CANCASTPERDAY:,1'], stats: { CHA: 12 } }));
    const h = characterSpellcasting(c)[0]!;
    assert.equal(h.stat, 'CHA');
    assert.deepEqual(h.levels.map((l) => [l.level, l.base, l.perDay]), [
      [0, null, 0],
      [1, 1, 2],
    ]);
  });

  test('the server builds the card and the spend: forged ones from a client are replaced', () => {
    fx = createRoomFixture();
    const { room, alice, act } = fx;
    act(
      alice,
      characterActions.import.create({
        character: makePcgCharacter(casterPcg({ classes: ['CLASS:Sorcerer|LEVEL:1|SKILLPOOL:0'], stats: { CHA: 14 }, spells: [spellLine('Magic Missile', 'Sorcerer', 1)] }), { id: 's' }),
      }),
    );
    act(
      alice,
      spellActions.cast.create({
        characterId: 's',
        className: 'Sorcerer',
        spellName: 'Magic Missile',
        level: 1,
        chatId: 'forged',
        card: { title: 'Wish', subtitle: 'DC 99' },
        spend: { className: 'Sorcerer', preparedId: null, markCast: false, slotKey: 'custom.free' },
      }),
    );
    const card = room.currentState.chat.find((m) => m.id === 'forged')!.card!;
    assert.match(card.title, /Magic Missile$/);
    const uses = room.currentState.characters.s!.runtime.uses;
    assert.deepEqual(uses, { [spellSlotKey('Sorcerer', 1)]: 1 });
  });

  test('character/updateRuntime cannot write prepared spells around the slot rules', () => {
    fx = createRoomFixture();
    const { room, alice, act } = fx;
    act(alice, characterActions.import.create({ character: makePcgCharacter(casterPcg({ classes: ['CLASS:Wizard|LEVEL:1|SKILLPOOL:0'], stats: { INT: 14 } }), { id: 'w' }) }));
    const flood = Array.from({ length: 50 }, (_, i) => ({ id: `p${i}`, name: 'Wish', level: 9, metamagic: [], slot: 'normal' as const, cast: false }));
    act(alice, characterSheetActions.updateRuntime.create({ id: 'w', changes: { prepared: { Wizard: flood } } as never }));
    assert.deepEqual(room.currentState.characters.w!.runtime.prepared, {});
  });

  test('re-import keeps spells prepared in the VTT; a class still on the file follows the new file', () => {
    fx = createRoomFixture();
    const { room, alice, act } = fx;
    const v1 = casterPcg({
      classes: ['CLASS:Cleric|LEVEL:1|SKILLPOOL:0', 'CLASS:Wizard|LEVEL:1|SKILLPOOL:0'],
      stats: { INT: 14, WIS: 14 },
      spells: [spellLine('Shield', 'Wizard', 1), spellLine('Shield', 'Wizard', 1, 'Prepared Spells'), spellLine('Bless', 'Cleric', 1, 'Prepared Spells')],
    });
    act(alice, characterActions.import.create({ character: makePcgCharacter(v1, { id: 'mc' }) }));
    act(alice, spellActions.prepare.create({ characterId: 'mc', className: 'Cleric', spells: [{ id: 'd', name: 'Divine Favor', level: 1, metamagic: [], slot: 'normal' }] }));
    const v2 = v1.replace('SPELLNAME:Shield|TIMES:1|CLASS:Wizard|BOOK:Prepared Spells', 'SPELLNAME:Shield|TIMES:2|CLASS:Wizard|BOOK:Prepared Spells').replace('Bless', 'Command');
    act(alice, characterActions.reimport.create({ id: 'mc', build: parsePcg(v2), fileName: 'v2.pcg' }));
    const infos = characterSpellcasting(room.currentState.characters.mc!);
    assert.deepEqual(infos.find((i) => i.className === 'Cleric')!.prepared.map((p) => p.name), ['Divine Favor']);
    assert.deepEqual(infos.find((i) => i.className === 'Wizard')!.prepared.map((p) => p.name), ['Shield', 'Shield']);
  });

  test('chat cards: rolls and areas are bounded', () => {
    assert.equal(ChatCardSchema.safeParse({ title: 'x', rolls: Array.from({ length: 5 }, () => ({ label: 'a', bonus: 1 })) }).success, false);
    assert.equal(ChatCardSchema.safeParse({ title: 'x', area: { kind: 'cone', feet: 2, label: '' } }).success, false);
    assert.equal(ChatCardSchema.safeParse({ title: 'x', area: { kind: 'circle', feet: 20, label: '20-ft.-radius spread' }, rolls: [{ label: 'Concentration', bonus: 9 }] }).success, true);
  });
});
