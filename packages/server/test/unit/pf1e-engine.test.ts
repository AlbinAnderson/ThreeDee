import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  characterHp,
  computeCharacterStats,
  createInitialState,
  createToken,
  makeItem,
  tokenSyncFor,
} from '@vtt/shared';
import { makePcgCharacter, SAMPLE_PCG, withPcgLines } from '../helpers/harness';

describe('unit: PF1e stat engine', () => {
  test('abilities apply base, racial, level-up, temp, drain and -1 per 2 ability damage', () => {
    const c = makePcgCharacter(SAMPLE_PCG);
    c.sheet.racialChoice = 'STR';
    c.runtime.abilityTemp.STR = 2; // 16 + 2 racial + 1 lvl + 2 temp = 21 (+5)
    c.runtime.abilityDrain.DEX = 2; // 15 - 2 = 13 (+1)
    c.runtime.abilityDamage.CON = 3; // score 14 (+2), 3 dmg => -1 => +1
    const s = computeCharacterStats(c);
    assert.equal(s.abilities.STR.score, 21);
    assert.equal(s.abilities.STR.mod, 5);
    assert.equal(s.abilities.DEX.score, 13);
    assert.equal(s.abilities.DEX.mod, 1);
    assert.equal(s.abilities.CON.score, 14);
    assert.equal(s.abilities.CON.mod, 1);
  });

  test('enforces minimum 1 HP per rolled hit die with negative Con modifier', () => {
    const c = makePcgCharacter(
      SAMPLE_PCG.replace('STAT:CON|SCORE:14', 'STAT:CON|SCORE:4') // Con -3
        .replace('HITPOINTS:10', 'HITPOINTS:2') // max(1, 2-3)=1
        .replace('HITPOINTS:7', 'HITPOINTS:1') // max(1, 1-3)=1
        .replace('HITPOINTS:6', 'HITPOINTS:5'), // max(1, 5-3)=2
    );
    assert.equal(computeCharacterStats(c).hp.total, 1 + 1 + 2);
  });

  test('computes AC, touch, flat-footed, CMB/CMD (including Tiny+ and Agile Maneuvers) and speed', () => {
    const c = makePcgCharacter(withPcgLines(SAMPLE_PCG, 'ABILITY:FEAT|TYPE:NORMAL|CATEGORY:FEAT|KEY:Dodge', 'ABILITY:FEAT|TYPE:NORMAL|CATEGORY:FEAT|KEY:Fleet'));
    c.sheet.size = 'Tiny';
    c.sheet.misc.deflection = 2;
    c.sheet.misc.natural = 1;
    const s = computeCharacterStats(c);
    // Tiny: +2 size to AC, -2 special size to CMB/CMD, always uses DEX for CMB.
    assert.equal(s.ac.normal.total, 10 + 2 + 2 + 1 + 2 + 1); // base + Dex2 + size2 + nat1 + defl2 + dodge1
    assert.equal(s.ac.touch.total, 10 + 2 + 2 + 2 + 1);
    assert.equal(s.ac.flatFooted.total, 10 + 2 + 1 + 2);
    assert.equal(s.cmb.total, 2 + 2 - 2); // BAB 2 + DEX 2 - 2
    assert.ok(s.cmb.parts.some((p) => p.source === 'Dex (Tiny)'));
    assert.equal(s.speed.total, 35, 'Fleet adds +5 in light/no armor');

    // Equipping heavy armor suppresses Fleet and reduces 40 ft -> 30 ft.
    c.sheet.speed = null;
    c.inventory.items.push(makeItem({ id: 'fp', name: 'Full Plate', weight: 50, armor: { kind: 'armor', category: 'heavy', bonus: 9, enhancement: 0, maxDex: 1, acp: -6, asf: 35 } }));
    c.inventory.loadouts[0]!.slots.fp = 'armor';
    assert.equal(computeCharacterStats(c).speed.total, 20, 'heavy armor drops 30 ft to 20 ft and disables Fleet');
  });

  test('computes weapon attacks: finesse, two-handed 1.5x Str, off-hand 0.5x Str, iteratives and TWF', () => {
    const c = makePcgCharacter(
      withPcgLines(
        SAMPLE_PCG.replace('CLASS:Fighter|LEVEL:2', 'CLASS:Fighter|LEVEL:6')
          .replace('CLASSABILITIESLEVEL:Fighter=2', 'CLASSABILITIESLEVEL:Fighter=6')
          .replace('STAT:DEX|SCORE:15', 'STAT:DEX|SCORE:20'),
        'ABILITY:FEAT|TYPE:NORMAL|CATEGORY:FEAT|KEY:Weapon Finesse',
        'ABILITY:FEAT|TYPE:NORMAL|CATEGORY:FEAT|KEY:Two-Weapon Fighting',
        'ABILITY:FEAT|TYPE:NORMAL|CATEGORY:FEAT|KEY:Improved Two-Weapon Fighting',
      ),
    );
    c.inventory.items.push(
      makeItem({ id: 'rap', name: '+1 Rapier', weight: 2, weapon: { damage: '1d6', critRange: 18, critMult: 2, range: 0, type: 'melee', hands: 'one', strDamage: 'full', finesse: true, enhancement: 1, masterwork: true } }),
      makeItem({ id: 'dag', name: 'Dagger', weight: 1, weapon: { damage: '1d4', critRange: 19, critMult: 2, range: 10, type: 'melee', hands: 'light', strDamage: 'full', finesse: true, enhancement: 0, masterwork: false } }),
    );
    c.inventory.loadouts[0]!.slots = { rap: 'primary', dag: 'offHand' };
    const s = computeCharacterStats(c);
    const rap = s.attacks.find((a) => a.itemId === 'rap')!;
    assert.equal(rap.attack.total, 6 + 5 + 1, 'BAB 6 + Dex 5 (Finesse) + 1');
    assert.deepEqual(rap.fullAttack, [12, 7]);
    assert.equal(rap.damage.total, 3 + 1, 'Str 3 + 1 enhancement');
    assert.deepEqual(s.twoWeapon?.primary, [10, 5], 'TWF + light off-hand: -2');
    assert.deepEqual(s.twoWeapon?.offHand, [9, 4], 'ITWF gives second off-hand iterative at -5');
  });

  test('tokenSyncFor clamps name, darkvision, HP and carried light to schema bounds', () => {
    const state = createInitialState('s1');
    state.scenes.s1!.grid.unitsPerCell = 1;
    const c = makePcgCharacter(SAMPLE_PCG);
    c.name = 'A'.repeat(80);
    c.sheet.darkvision = 600;
    c.inventory.items.push(makeItem({ id: 't', name: 'Torch', light: { bright: 250, dim: 500 }, lit: true }));
    const tok = createToken({ id: 'tok', sceneId: 's1', x: 0, y: 0 });
    const sync = tokenSyncFor(state, c, tok);
    assert.equal(sync.name.length, 60);
    assert.equal(sync.darkvision, 200);
    assert.deepEqual(sync.light, { bright: 200, dim: 400, color: '#ffd28a' });

    tok.hp = { value: 12, max: 30, temp: 4 };
    c.tokenId = 'tok';
    state.tokens.tok = tok;
    assert.deepEqual(characterHp(state, c, 30), { current: 12, temp: 4, nonlethal: 0, fromToken: true });
  });
});
