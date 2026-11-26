import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import {
  characterActions,
  characterSheetActions,
  characterSpellcasting,
  ChatCardSchema,
  checkPrepared,
  createInitialState,
  CURRENT_SCHEMA_VERSION,
  lookupSpell,
  migrateState,
  parsePcg,
  planCast,
  spellActions,
  spellCard,
  spellDcLevel,
  spellSchool,
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

  test('GM-only cast on a shared character never leaks card or spell name over the wire to non-recipients', () => {
    fx = createRoomFixture();
    const { room, alice, bob, gm, act } = fx;
    const sorc = {
      ...makePcgCharacter(
        casterPcg({ classes: ['CLASS:Sorcerer|LEVEL:3|SKILLPOOL:0'], stats: { CHA: 16 }, spells: [spellLine('Burning Hands', 'Sorcerer', 1)] }),
        { id: 'sorc' },
      ),
      shared: true,
    };
    act(alice, characterActions.import.create({ character: sorc }));
    const bobBefore = bob.inbox.length;
    const gmBefore = gm.inbox.length;
    act(
      alice,
      spellActions.cast.create({
        characterId: 'sorc',
        className: 'Sorcerer',
        spellName: 'Burning Hands',
        level: 1,
        chatId: 'secret-cast',
        whisper: { mode: 'gm', to: [] },
      }),
    );
    const bobMsgs = bob.inbox.slice(bobBefore).filter((m) => m.t === 'action' && m.action.type === 'pf1e/castSpell');
    assert.equal(bobMsgs.length, 1, 'Bob still gets the slot spend so his copy of the shared sheet stays in sync');
    const bobJson = JSON.stringify(bobMsgs);
    assert.doesNotMatch(bobJson, /Burning Hands|"card"|"whisper"/, 'Bob must not receive the secret spell card or spell name over the wire');
    const gmMsgs = gm.inbox.slice(gmBefore).filter((m) => m.t === 'action' && m.action.type === 'pf1e/castSpell');
    assert.match(JSON.stringify(gmMsgs), /Burning Hands/, 'GM receives the full spell card');
    assert.equal(room.currentState.characters.sorc!.runtime.uses[spellSlotKey('Sorcerer', 1)], 1);
  });

  test('character/import rejects pre-populated runtime.prepared', () => {
    fx = createRoomFixture();
    const { room, alice, act } = fx;
    const c = makePcgCharacter(casterPcg({ classes: ['CLASS:Wizard|LEVEL:1|SKILLPOOL:0'], stats: { INT: 14 } }), { id: 'badwiz' });
    c.runtime.prepared = { Wizard: [{ id: 'w1', name: 'Wish', level: 9, metamagic: [], slot: 'normal', cast: false }] };
    act(alice, characterActions.import.create({ character: c }));
    assert.ok(alice.rejects().includes('Prepare spells after importing'));
    assert.equal(room.currentState.characters.badwiz, undefined);
  });

  test('Bloodrager uses spontaneous 4-level slots and full caster level starting at level 4', () => {
    const br3 = characterSpellcasting(makePcgCharacter(casterPcg({ classes: ['CLASS:Bloodrager|LEVEL:3|SKILLPOOL:0'], stats: { CHA: 12 } })))[0]!;
    assert.equal(br3.casterLevel, 0);
    assert.equal(br3.maxLevel, -1);
    const br4 = characterSpellcasting(makePcgCharacter(casterPcg({ classes: ['CLASS:Bloodrager|LEVEL:4|SKILLPOOL:0'], stats: { CHA: 11 } })))[0]!;
    assert.equal(br4.casterLevel, 4, 'Bloodrager CL equals full class level starting at 4th');
    assert.equal(br4.levels.find((l) => l.level === 1)!.perDay, 1, 'Bloodrager 4 gets 1 base 1st-level slot even with Cha 11');
    const br20 = characterSpellcasting(makePcgCharacter(casterPcg({ classes: ['CLASS:Bloodrager|LEVEL:20|SKILLPOOL:0'], stats: { CHA: 10 } })))[0]!;
    assert.deepEqual(br20.levels.map((l) => l.base), [4, 4, 3, 2], 'Bloodrager 20: 4/4/3/2 (Archives of Nethys class table)');
  });

  test('lookupSpell resolves PCGen variant names to the variant, never the base spell', () => {
    // PCGen's Pathfinder data names variants "Invisibility (Greater)"; 3.5-style data uses "Invisibility, Greater".
    assert.equal(lookupSpell('Invisibility (Greater)')?.name, 'Greater Invisibility');
    assert.equal(lookupSpell('Cure Light Wounds (Mass)')?.name, 'Mass Cure Light Wounds');
    assert.equal(lookupSpell('Restoration (Lesser)')?.name, 'Lesser Restoration');
    assert.equal(lookupSpell('Invisibility, Greater')?.name, 'Greater Invisibility');
    assert.equal(lookupSpell('Cure Light Wounds, Mass')?.name, 'Mass Cure Light Wounds');
    assert.equal(spellSchool('Invisibility, Greater'), 'Illusion');
    // A variant the table lacks is unknown (its numbers differ), but keeps the base spell's school for Spell Focus.
    assert.equal(lookupSpell('Mage Armor (Communal)'), undefined);
    assert.equal(spellSchool('Mage Armor (Communal)'), 'Conjuration');
    assert.equal(lookupSpell('Fireball (EB)')?.name, 'Fireball', 'other qualifiers are ignored');
    assert.equal(lookupSpell('Invisibility')?.name, 'Invisibility');
  });

  test('Arcanist cannot prepare duplicate spells, Heighten+Empower computes DC accurately, and .pcg prepared books overflow into bonus slots', () => {
    const arc = makePcgCharacter(
      casterPcg({
        classes: ['CLASS:Arcanist|LEVEL:1|SKILLPOOL:0'],
        stats: { INT: 16 },
        spells: [spellLine('Magic Missile', 'Arcanist', 1)],
      }),
    );
    assert.match(
      checkPrepared(arc, 'Arcanist', [
        { id: '1', name: 'Magic Missile', level: 1, metamagic: [], slot: 'normal' },
        { id: '2', name: 'Magic Missile', level: 1, metamagic: [], slot: 'normal' },
      ]) as string,
      /already prepared/,
    );

    const wiz = makePcgCharacter(
      casterPcg({
        classes: ['CLASS:Wizard|SUBCLASS:Evoker|LEVEL:1|SKILLPOOL:0'],
        stats: { INT: 14 },
        spells: [
          spellLine('Magic Missile', 'Wizard', 1),
          spellLine('Shield', 'Wizard', 1),
          spellLine('Burning Hands', 'Wizard', 1),
          spellLine('Magic Missile', 'Wizard', 1, 'Prepared Spells', 2),
          spellLine('Burning Hands', 'Wizard', 1, 'Prepared Spells', 1),
        ],
      }),
    );
    const w = characterSpellcasting(wiz)[0]!;
    // Wizard 1, Int 14: 1 base + 1 bonus = 2 normal slots + 1 school slot -> 3rd prepared spell overflows into bonus slot.
    assert.deepEqual(
      w.prepared.map((p) => p.slot),
      ['normal', 'normal', 'bonus'],
    );
    assert.equal(checkPrepared(wiz, 'Wizard', w.prepared), true, 'full .pcg prepared list passes checkPrepared cleanly');
    assert.equal(spellDcLevel(w, 'Magic Missile', 5, ['Heighten Spell', 'Empower Spell']), 3, 'Heighten + Empower subtracts Empower (+2) from slot 5');
  });
});
