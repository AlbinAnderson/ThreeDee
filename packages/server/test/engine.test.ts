import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import {
  baseSaveFor,
  characterActions,
  characterHp,
  characterSheetActions,
  combatActions,
  computeCharacterStats,
  createCharacterFromPcg,
  createInitialState,
  createToken,
  CURRENT_SCHEMA_VERSION,
  migrateState,
  newId,
  parsePcg,
  sumModifiers,
  tokenActions,
  tokenSyncFor,
  type Character,
  type GameAction,
  type User,
} from '@vtt/shared';
import { SqliteRoomStore } from '../src/persistence/SqliteRoomStore';
import { Room, type Client } from '../src/rooms/Room';

const SAMPLE = fs.readFileSync(new URL('./fixtures/sample-pf1e.pcg', import.meta.url), 'utf8');

function character(pcg = SAMPLE, sheet: Partial<Character['sheet']> = {}): Character {
  const c = createCharacterFromPcg(parsePcg(pcg), { id: newId(), ownerId: 'alice', fileName: 'v.pcg', importedBy: 'alice', now: 1 });
  c.sheet = { ...c.sheet, ...sheet };
  return c;
}

const withLines = (...lines: string[]) => `${SAMPLE}\n${lines.join('\n')}\n`;

describe('bonus stacking', () => {
  test('same-type bonuses take the highest; dodge, untyped and penalties stack', () => {
    const line = sumModifiers([
      { value: 2, type: 'enhancement', source: 'Belt +2' },
      { value: 4, type: 'enhancement', source: "Bull's Strength" },
      { value: 1, type: 'dodge', source: 'Dodge' },
      { value: 1, type: 'dodge', source: 'Haste' },
      { value: 1, type: 'untyped', source: 'A' },
      { value: 1, type: 'untyped', source: 'B' },
      { value: -2, type: 'morale', source: 'Shaken' },
      { value: -1, type: 'morale', source: 'Other penalty' },
    ]);
    assert.equal(line.total, 4 + 2 + 2 - 3);
    assert.equal(line.parts.find((p) => p.source === 'Belt +2')!.applied, false);
  });
});

describe('PF1e stat engine', () => {
  test('sample Fighter 2 / Wizard 1 matches the rules', () => {
    const s = computeCharacterStats(character());
    assert.equal(s.abilities.STR.score, 17, 'base 16 + level-up 1');
    assert.equal(s.hitDice, 3);
    assert.equal(s.bab.total, 2);
    assert.equal(s.saves.fort.total, 5, 'Fighter good 3 + Wizard poor 0 + Con 2');
    assert.equal(s.saves.ref.total, 2);
    assert.equal(s.saves.will.total, 3, 'Wizard good 2 + Wis 1');
    assert.equal(s.hp.total, 23 + 2 * 3);
    assert.equal(s.ac.normal.total, 12);
    assert.equal(s.cmb.total, 5);
    assert.equal(s.cmd.total, 17);
    assert.equal(s.initiative.total, 4, 'Dex 2 + Reactionary trait 2');
    assert.ok(s.warnings.some((w) => w.includes('racial +2')));
  });

  test('racial +2 choice and fixed racial modifiers', () => {
    assert.equal(computeCharacterStats(character(SAMPLE, { racialChoice: 'STR' })).abilities.STR.score, 19);
    const elf = computeCharacterStats(character(SAMPLE.replace('RACE:Human', 'RACE:Elf')));
    assert.equal(elf.abilities.DEX.score, 17);
    assert.equal(elf.abilities.CON.score, 12);
    assert.equal(elf.senses.lowLight, true);
    assert.equal(elf.warnings.length, 0);
  });

  test('small races: size bonus to AC, penalty to CMB/CMD, slower', () => {
    const s = computeCharacterStats(character(SAMPLE.replace('RACE:Human', 'RACE:Halfling')));
    assert.equal(s.size, 'Small');
    assert.equal(s.ac.normal.total, 10 + 3 + 1, 'Dex 15+2=17 (+3), size +1');
    assert.equal(s.cmb.total, 2 + 2 - 1, 'BAB 2, Str 16-2+1=15 (+2), small -1');
    assert.equal(s.cmd.total, 10 + 2 + 2 + 3 - 1);
    assert.equal(s.speed.total, 20);
  });

  test('feats: Toughness, Iron Will, Improved Initiative, Dodge', () => {
    const s = computeCharacterStats(
      character(
        withLines(
          'ABILITY:FEAT|TYPE:NORMAL|CATEGORY:FEAT|KEY:Toughness',
          'ABILITY:FEAT|TYPE:NORMAL|CATEGORY:FEAT|KEY:Iron Will',
          'ABILITY:FEAT|TYPE:NORMAL|CATEGORY:FEAT|KEY:Improved Initiative',
          'ABILITY:FEAT|TYPE:NORMAL|CATEGORY:FEAT|KEY:Dodge',
        ),
      ),
    );
    assert.equal(s.hp.total, 29 + 3);
    assert.equal(s.saves.will.total, 5);
    assert.equal(s.initiative.total, 8);
    assert.equal(s.ac.normal.total, 13);
    assert.equal(s.ac.flatFooted.total, 10, 'no Dex or dodge when flat-footed');
    assert.equal(s.cmd.total, 18);
  });

  test('worn armor is detected from the active equipment set and caps Dex', () => {
    const s = computeCharacterStats(
      character(
        withLines(
          'EQUIPNAME:+1 Chain Shirt|OUTPUTORDER:4|COST:1250|WT:25|QUANTITY:1.0',
          'EQUIPNAME:Heavy Steel Shield|OUTPUTORDER:5|COST:20|WT:15|QUANTITY:1.0',
          'EQUIPSET:Body|ID:0.1.3|VALUE:+1 Chain Shirt|QUANTITY:1.0',
          'EQUIPSET:Off Hand|ID:0.1.4|VALUE:Heavy Steel Shield|QUANTITY:1.0',
        ).replace('STAT:DEX|SCORE:15', 'STAT:DEX|SCORE:20'),
      ),
    );
    assert.deepEqual(s.armor.worn, ['+1 Chain Shirt', 'Heavy Steel Shield']);
    assert.equal(s.armor.maxDex, 4);
    assert.equal(s.ac.normal.total, 10 + 5 + 2 + 4, 'chain shirt 4+1, shield 2, Dex +5 capped at +4');
    assert.equal(s.ac.touch.total, 14);
  });

  test('unknown classes ask for a progression; sheet overrides and prestige formulas work', () => {
    const pcg = SAMPLE.replace('CLASS:Wizard|LEVEL:1', 'CLASS:Eldritch Knight|LEVEL:1').replace('CLASSABILITIESLEVEL:Wizard=1', 'CLASSABILITIESLEVEL:Eldritch Knight=1');
    assert.ok(computeCharacterStats(character(pcg)).warnings.some((w) => w.includes('Eldritch Knight')));
    const s = computeCharacterStats(character(pcg, { classChassis: { 'Eldritch Knight': { hd: 10, bab: 'full', goodSaves: ['fort'], prestige: true } } }));
    assert.equal(s.bab.total, 3);
    assert.equal(s.saves.fort.total, 3 + 1 + 2, 'Fighter 3 + prestige good 1 + Con 2');
    assert.equal(baseSaveFor(true, 10, true), 5);
    assert.equal(baseSaveFor(false, 10, false), 3);
  });

  test('ability damage applies -1 per 2 damage without altering score; drain and temp change the score', () => {
    const c = character(SAMPLE.replace('STAT:STR|SCORE:16', 'STAT:STR|SCORE:15')); // 15 + 1 lvl = 16 (+3)
    c.runtime.abilityDamage = { STR: 1 };
    assert.equal(computeCharacterStats(c).abilities.STR.score, 16);
    assert.equal(computeCharacterStats(c).abilities.STR.mod, 3, '1 point of damage on even score does not penalize mod');

    c.runtime.abilityDamage = { STR: 3 };
    assert.equal(computeCharacterStats(c).abilities.STR.mod, 2, '3 points of damage = -1 penalty');

    c.runtime.abilityDamage = { STR: 2 };
    c.runtime.abilityTemp = { DEX: 4 };
    const s = computeCharacterStats(c);
    assert.equal(s.abilities.STR.score, 16);
    assert.equal(s.abilities.STR.mod, 2);
    assert.equal(s.abilities.DEX.score, 19);
    assert.equal(s.initiative.total, 6);
  });

  test('carried/not-carried armor and non-armor leather items are ignored; Fleet stops in heavy armor; Tiny CMB & min 1 HP/HD', () => {
    const s = computeCharacterStats(
      character(
        withLines(
          'ABILITY:FEAT|TYPE:NORMAL|CATEGORY:FEAT|KEY:Fleet',
          'ABILITY:FEAT|TYPE:NORMAL|CATEGORY:FEAT|KEY:Toughness',
          'FEAT:Toughness',
          'EQUIPNAME:Full Plate|OUTPUTORDER:4|COST:1500|WT:50|QUANTITY:1.0',
          'EQUIPNAME:Leather Boots|OUTPUTORDER:5|COST:1|WT:1|QUANTITY:1.0',
          'EQUIPSET:Carried|ID:0.1.3|VALUE:Full Plate|QUANTITY:1.0',
          'EQUIPSET:Feet|ID:0.1.4|VALUE:Leather Boots|QUANTITY:1.0',
        ),
      ),
    );
    assert.deepEqual(s.armor.worn, []);
    assert.equal(s.ac.normal.total, 12);
    assert.equal(s.speed.total, 35, 'Fleet applies without medium/heavy armor');
    assert.equal(s.hp.total, 29 + 3, 'duplicate Toughness lines are not double-counted');

    const armored = computeCharacterStats(
      character(
        withLines(
          'ABILITY:FEAT|TYPE:NORMAL|CATEGORY:FEAT|KEY:Fleet',
          'EQUIPNAME:Full Plate|OUTPUTORDER:4|COST:1500|WT:50|QUANTITY:1.0',
          'EQUIPSET:Armor|ID:0.1.3|VALUE:Full Plate|QUANTITY:1.0',
        ),
      ),
    );
    assert.equal(armored.speed.total, 20, 'Fleet does not apply in heavy armor');

    const android = computeCharacterStats(character(SAMPLE.replace('RACE:Human', 'RACE:Android')));
    assert.equal(android.senses.darkvision, 60);
    assert.equal(android.senses.lowLight, true);

    const tiny = computeCharacterStats(character(SAMPLE.replace('STAT:DEX|SCORE:15', 'STAT:DEX|SCORE:8'), { size: 'Tiny' }));
    assert.equal(tiny.cmb.total, 2 - 1 - 2, 'Tiny creature always uses Dex for CMB even when Str > Dex');

    const frail = computeCharacterStats(
      character(
        SAMPLE.replace('STAT:CON|SCORE:14', 'STAT:CON|SCORE:4')
          .replace('HITPOINTS:10', 'HITPOINTS:1')
          .replace('HITPOINTS:7', 'HITPOINTS:1')
          .replace('HITPOINTS:6', 'HITPOINTS:1'),
      ),
    );
    assert.equal(frail.hp.total, 3, 'each rolled level grants at least 1 HP');
  });

  test('tokenSyncFor clamps long names and high darkvision to TokenSchema bounds; v4->v5 migration works', () => {
    const state = createInitialState('scene1');
    state.scenes.scene1!.grid.unitsPerCell = 1;
    const c = character(SAMPLE, { darkvision: 600 });
    c.name = 'A'.repeat(80);
    const tok = createToken({ id: 'tok', sceneId: 'scene1', x: 0, y: 0 });
    const sync = tokenSyncFor(state, c, tok);
    assert.equal(sync.name.length, 60);
    assert.equal(sync.darkvision, 200);

    const v5 = createInitialState('s');
    const { sheet: _s, runtime: _r, ...cRest } = c;
    const migrated = migrateState({
      ...v5,
      schemaVersion: 4,
      characters: { [c.id]: { ...cRest, runtime: { hp: null, uses: {} } } },
    });
    assert.equal(migrated.schemaVersion, CURRENT_SCHEMA_VERSION);
    assert.equal(migrated.characters[c.id]!.sheet.racialChoice, null);
    assert.deepEqual(migrated.characters[c.id]!.runtime.abilityDamage, {});
  });
});

// ------------------------------------------------------------------ token sync through the room

let dir: string;
let store: SqliteRoomStore;
/** Rooms are flushed before the store closes, so no debounced save fires afterwards. */
const openRooms: Room[] = [];
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vtt-test-'));
  store = new SqliteRoomStore(path.join(dir, 'vtt.db'));
});
afterEach(async () => {
  for (const r of openRooms.splice(0)) await r.flush({ autoSnapshot: false });
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const gmUser: User = { id: 'gm1', name: 'Dana', role: 'gm', color: '#ff0000' };
const alice: User = { id: 'alice', name: 'Alice', role: 'player', color: '#00ff00' };
const client = (): Client => ({ id: newId(), user: null, room: null, seq: 0, send: () => {} });

describe('character ↔ token sync', () => {
  test('linking pushes HP, name, darkvision, size and initiative; the token then holds live HP; unlinking keeps it', () => {
    const room = new Room('main', createInitialState('scene1'), store, { autoIntervalMs: 1e12, keepAllForMs: 1e12, keepDailyForMs: 1e12 });
    openRooms.push(room);
    const g = client();
    const a = client();
    room.join(g, gmUser);
    room.join(a, alice);
    const act = (c: Client, action: GameAction) => room.handleClientAction(c, newId(), action);
    const c = character(SAMPLE.replace('RACE:Human', 'RACE:Dwarf'));
    act(a, characterActions.import.create({ character: c }));
    act(g, tokenActions.create.create({ token: createToken({ id: 'tok', sceneId: 'scene1', x: 0, y: 0, name: 'Token' }) }));
    act(g, combatActions.add.create({ combatant: { id: 'cb', name: 'Token', tokenId: 'tok', initiative: null, modifier: 0, hidden: false } }));

    act(g, characterActions.linkToken.create({ id: c.id, tokenId: 'tok' }));
    const s = computeCharacterStats(room.currentState.characters[c.id]!);
    const tok = () => room.currentState.tokens.tok!;
    assert.equal(tok().name, 'Valeros & Friends');
    assert.deepEqual(tok().hp, { value: s.hp.total, max: s.hp.total, temp: 0 });
    assert.equal(tok().darkvision, 12, 'dwarf 60 ft on a 5 ft grid');
    assert.equal(tok().size, 1);
    assert.equal(room.currentState.combat.combatants[0]!.modifier, s.initiative.total);

    // Damage on the token is the character's HP.
    act(a, tokenActions.update.create({ id: 'tok', changes: { hp: { ...tok().hp!, value: 10 } } }));
    assert.equal(characterHp(room.currentState, room.currentState.characters[c.id]!, s.hp.total).current, 10);

    // A sheet change that raises max HP keeps the damaged value.
    act(a, characterSheetActions.updateSheet.create({ id: c.id, changes: { misc: { hp: 3 } } }));
    act(a, characterSheetActions.syncToken.create({ id: c.id }));
    assert.deepEqual(tok().hp, { value: 10, max: s.hp.total + 3, temp: 0 });

    // Sheet/runtime updates carry only the changes, not a second copy of the character.
    const inbox: unknown[] = [];
    const watcher: Client = { id: newId(), user: null, room: null, seq: 0, send: (m) => inbox.push(m) };
    room.join(watcher, { ...gmUser, id: 'gm2', name: 'Co-GM' });
    act(a, characterSheetActions.updateRuntime.create({ id: c.id, changes: { abilityTemp: { STR: 2 } } }));
    const sent = JSON.stringify(inbox.at(-1));
    assert.ok(sent.includes('character/updateRuntime') && !sent.includes('"build"'), 'no full character in the broadcast');

    act(a, characterActions.linkToken.create({ id: c.id, tokenId: null }));
    assert.equal(room.currentState.characters[c.id]!.runtime.hp!.current, 10, 'unlinking copies live HP back');
  });
});
