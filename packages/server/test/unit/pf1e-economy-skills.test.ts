import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  applySpend,
  canSpend,
  characterResources,
  classActionSetsFor,
  computeCharacterStats,
  computeSkills,
  createInitialState,
  createToken,
  effectiveTurn,
  freshTurn,
  lookupPf1Action,
  situationalFor,
  skillRollExpression,
  turnWindow,
} from '@vtt/shared';
import { makePcgCharacter, SAMPLE_PCG, withPcgLines } from '../helpers/harness';

describe('unit: PF1e action economy', () => {
  test('turnWindow and effectiveTurn track active turn, round-1 flat-footed, Combat Reflexes and immediate lock', () => {
    const state = createInitialState('s1');
    const c = makePcgCharacter(withPcgLines(SAMPLE_PCG, 'ABILITY:FEAT|TYPE:NORMAL|CATEGORY:FEAT|KEY:Combat Reflexes'));
    c.tokenId = 't1';
    state.characters[c.id] = c;
    state.tokens.t1 = createToken({ id: 't1', sceneId: 's1', x: 0, y: 0 });
    state.combat = {
      active: true,
      round: 1,
      currentId: 'cb2',
      combatants: [
        { id: 'cb2', name: 'Goblin', tokenId: null, initiative: 20, modifier: 0, hidden: false },
        { id: 'cb1', name: 'Hero', tokenId: 't1', initiative: 10, modifier: 0, hidden: false },
      ],
    };
    assert.equal(turnWindow(state, 'cb2'), 1);
    assert.equal(turnWindow(state, 'cb1'), 0);

    const e1 = effectiveTurn(state, 'cb1');
    assert.equal(e1.flatFooted, true);
    assert.equal(e1.combatReflexes, true);
    assert.equal(e1.aooMax, 3, '1 + Dex (+2)');
    assert.equal(canSpend(e1, 'aoo'), true, 'Combat Reflexes allows AoO while flat-footed');
    assert.notEqual(canSpend(e1, 'immediate'), true, 'flat-footed still blocks immediate actions');

    // Hero acts in round 1, then on round 2 Goblin goes first: Hero uses off-turn immediate -> locks round 2 swift.
    state.combat.currentId = 'cb1';
    state.combat.currentId = 'cb2';
    state.combat.round = 2;
    const off = effectiveTurn(state, 'cb1');
    assert.equal(off.turn.window, 1);
    const mut = { ...off.turn };
    applySpend(mut, off, 'immediate');
    state.pf1eTurns.cb1 = mut;
    assert.equal(mut.immediateLock, 2);

    state.combat.currentId = 'cb1';
    const next = effectiveTurn(state, 'cb1');
    assert.equal(next.turn.swift, true);
    assert.notEqual(canSpend(next, 'swift'), true);
  });

  test('canSpend and applySpend enforce standard+move, two moves, full-round and 5-ft/movement exclusivity', () => {
    const base = { turn: freshTurn(1), isTurn: true, flatFooted: false, swiftLocked: false, aooMax: 1, combatReflexes: false };
    assert.equal(canSpend(base, 'fullRound'), true);

    const t1 = freshTurn(1);
    applySpend(t1, base, 'move', true);
    assert.equal(t1.move, true);
    assert.equal(t1.moved, true);
    assert.notEqual(canSpend({ ...base, turn: t1 }, 'fiveFoot'), true);
    assert.notEqual(canSpend({ ...base, turn: t1 }, 'fullRound'), true);
    assert.equal(canSpend({ ...base, turn: t1 }, 'move'), true, 'standard can trade for second move');
    applySpend(t1, { ...base, turn: t1 }, 'move');
    assert.equal(t1.standard, true);
    assert.notEqual(canSpend({ ...base, turn: t1 }, 'standard'), true);
  });

  test('classActionSetsFor and characterResources expose class pools and actions', () => {
    const c = makePcgCharacter(SAMPLE_PCG); // Fighter 2 / Wizard 1
    assert.deepEqual(classActionSetsFor(c.build.classes).map((x) => x.set.className), ['Wizard']);
    const resources = characterResources(c);
    assert.equal(resources.find((r) => r.def.id === 'bond')?.max, 1);
    assert.equal(resources.find((r) => r.def.id === 'school')?.max, 3);
    assert.equal(lookupPf1Action('c.investigator.inspireattack')?.resourceCost, 2);
  });
});

describe('unit: PF1e skills engine', () => {
  test('computes ranks, class skill, ACP, size, racial, feats, class bonuses and situational toggles', () => {
    const c = makePcgCharacter(
      withPcgLines(
        SAMPLE_PCG.replace('RACE:Human', 'RACE:Tengu')
          .replace('CLASS:Wizard|LEVEL:1', 'CLASS:Bard|LEVEL:4')
          .replace('CLASSABILITIESLEVEL:Wizard=1', 'CLASSABILITIESLEVEL:Bard=4'),
        'ABILITY:FEAT|TYPE:NORMAL|CATEGORY:FEAT|KEY:Stealthy',
        'ABILITY:FEAT|TYPE:NORMAL|CATEGORY:FEAT|KEY:Skill Focus|APPLIEDTO:Stealth',
      ),
    );
    const stats = computeCharacterStats(c);
    const sum = computeSkills(c, stats);
    const stealth = sum.rows.find((r) => r.name === 'Stealth')!;
    assert.ok(stealth.total.parts.some((p) => p.source === 'Tengu' && p.value === 2));
    assert.ok(stealth.total.parts.some((p) => p.source === 'Stealthy' && p.value === 2));
    assert.ok(stealth.total.parts.some((p) => p.source === 'Skill Focus' && p.value === 3));

    const ling = sum.rows.find((r) => r.name === 'Linguistics')!;
    assert.equal(ling.total.parts.find((p) => p.source === 'Tengu')?.value, 4);

    const planes = sum.rows.find((r) => r.name === 'Knowledge (Planes)')!;
    assert.equal(planes.usable, true, 'Bardic knowledge allows untrained Knowledge');
    assert.equal(planes.total.parts.find((p) => p.source === 'Bardic knowledge')?.value, 2);

    assert.equal(skillRollExpression(5, [2, '1d6']), '1d20+1d6+7');
    assert.equal(skillRollExpression(-1, [], 10), '10-1');
    assert.equal(situationalFor(c, stats, stealth).length, 0);
  });
});
