import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  blockingSegments,
  cellCenter,
  createInitialState,
  DiceError,
  formatTermNotation,
  isPathBlocked,
  measureDistance,
  parseDice,
  polygonToSvgPoints,
  rollDice,
  segmentsIntersect,
  snapTokenPosition,
  templateCells,
  templateContains,
  visibilityPolygon,
  type GridSettings,
  type Template,
  type Wall,
} from '@vtt/shared';

const GRID: GridSettings = createInitialState('s1').scenes.s1!.grid;

describe('unit: dice parser & roller', () => {
  test('parses standard, multi-term, percentile, constant and keep-highest/lowest formulas', () => {
    assert.equal(parseDice('1d20+5').length, 2);
    assert.equal(parseDice('d%').at(0)?.kind, 'dice');
    assert.deepEqual(
      parseDice('4d6kh3 - 1d4kl1 + 2').map((t) => (t.kind === 'dice' ? `${t.sign < 0 ? '-' : ''}${t.count}d${t.sides}${t.keep ? `k${t.keep.mode}${t.keep.n}` : ''}` : `${t.sign < 0 ? '-' : ''}${t.value}`)),
      ['4d6kh3', '-1d4kl1', '2'],
    );
  });

  test('rolls deterministically with injected RNG and applies keep-highest / keep-lowest', () => {
    const seq = [0, 5, 2, 4]; // die faces: 1, 6, 3, 5
    let i = 0;
    const high = rollDice('4d6kh3+2', () => seq[i++]!);
    assert.equal(high.total, 6 + 3 + 5 + 2);
    assert.equal(high.terms[0]!.kind, 'dice');
    assert.equal(high.terms[0]!.rolls.filter((r) => r.dropped).length, 1);
    assert.equal(formatTermNotation(high.terms[0]!), '4d6kh3');
    assert.equal(formatTermNotation(high.terms[1]!), '2');

    let j = 0;
    const low = rollDice('2d20kl1-3', () => [18, 4][j++]!); // faces 19 and 5 -> keep 5 - 3 = 2
    assert.equal(low.total, 2);
  });

  test('rejects invalid dice expressions and enforces safety limits', () => {
    assert.throws(() => parseDice(''), DiceError);
    assert.throws(() => parseDice('0d6'), /at least one die/i);
    assert.throws(() => parseDice('1d0'), /at least one side/i);
    assert.throws(() => parseDice('2d6kh3'), /Can't keep 3 of 2/i);
    assert.throws(() => parseDice('201d6'), /At most 200 dice/i);
    assert.throws(() => parseDice('1d10001'), /at most 10000 sides/i);
    assert.throws(() => parseDice('1d20+3.5'), DiceError);
    assert.throws(() => parseDice('1+1+1+1+1+1+1+1+1+1+1+1+1+1+1+1+1+1+1+1+1'), /Too many terms/i);
  });
});

describe('unit: grid geometry, distance & templates', () => {
  test('snaps tokens and computes cell centers respecting grid offset and snap flag', () => {
    const offsetGrid: GridSettings = { ...GRID, size: 70, offsetX: 10, offsetY: 20, snap: true };
    assert.deepEqual(snapTokenPosition({ x: 85, y: 155 }, offsetGrid), { x: 80, y: 160 });
    assert.deepEqual(snapTokenPosition({ x: 85, y: 155 }, { ...offsetGrid, snap: false }), { x: 85, y: 155 });
    assert.deepEqual(snapTokenPosition({ x: 85, y: 155 }, { ...offsetGrid, type: 'none' }), { x: 85, y: 155 });
    assert.deepEqual(cellCenter({ x: 15, y: 25 }, offsetGrid), { x: 45, y: 55 });
  });

  test('measures distances under alternating (PF1e 5-10-5), chebyshev, manhattan and euclidean rules', () => {
    const a = { x: 0, y: 0 };
    const b = { x: 210, y: 140 }; // dx = 3, dy = 2
    assert.deepEqual(measureDistance(a, b, { ...GRID, diagonals: 'alternating' }), { cells: 4, distance: 20 });
    assert.deepEqual(measureDistance(a, b, { ...GRID, diagonals: 'chebyshev' }), { cells: 3, distance: 15 });
    assert.deepEqual(measureDistance(a, b, { ...GRID, diagonals: 'manhattan' }), { cells: 5, distance: 25 });
    const euclid = measureDistance(a, b, { ...GRID, diagonals: 'euclidean' });
    assert.ok(Math.abs(euclid.cells - Math.hypot(3, 2)) < 1e-6);
  });

  test('computes cells for circle, square, cone and line templates', () => {
    const base: Template = { id: 't1', sceneId: 's1', authorId: 'u1', kind: 'circle', x: 700, y: 700, size: 2, angle: 0, coneAngle: 90, width: 1, color: '#f00' };
    assert.equal(templateCells(base, GRID).length, 12);
    assert.equal(templateContains(base, { x: 735, y: 735 }, GRID.size), true);
    assert.equal(templateContains(base, { x: 910, y: 735 }, GRID.size), false);

    const sq: Template = { ...base, kind: 'square', size: 2 };
    assert.equal(templateCells(sq, GRID).length, 16);

    const line: Template = { ...base, kind: 'line', size: 4, x: 700, y: 735, angle: 0 };
    assert.equal(templateCells(line, GRID).length, 4);

    const cone: Template = { ...base, kind: 'cone', size: 3, x: 700, y: 700, angle: 0, coneAngle: 90 };
    assert.ok(templateCells(cone, GRID).length > 0);
  });
});

describe('unit: visibility & wall blocking', () => {
  test('filters open doors out of blocking segments and detects intersections', () => {
    const walls: Wall[] = [
      { id: 'w1', sceneId: 's1', points: [50, -50, 50, 50], door: null },
      { id: 'w2', sceneId: 's1', points: [100, -50, 100, 50], door: 'open' },
      { id: 'w3', sceneId: 's1', points: [150, -50, 150, 50], door: 'closed' },
    ];
    const segs = blockingSegments(walls);
    assert.equal(segs.length, 2);
    assert.equal(segmentsIntersect({ x: 0, y: 0 }, { x: 60, y: 0 }, segs[0]!), true);
    assert.equal(segmentsIntersect({ x: 0, y: 0 }, { x: 40, y: 0 }, segs[0]!), false);
    assert.equal(isPathBlocked({ x: 0, y: 0 }, { x: 120, y: 0 }, segs), true);
    assert.equal(isPathBlocked({ x: 60, y: 0 }, { x: 120, y: 0 }, segs), false, 'open door does not block');
  });

  test('visibilityPolygon stops rays at walls and formats SVG points', () => {
    const poly = visibilityPolygon({ x: 0, y: 0 }, [[20, -40, 20, 40]], { minX: -100, minY: -100, maxX: 100, maxY: 100 });
    assert.ok(poly.length >= 6);
    assert.ok(poly.every((p) => p.x <= 20 + 1e-6 || Math.abs(p.y) >= 40 - 1e-6));
    const svg = polygonToSvgPoints(poly);
    assert.equal(svg.split(' ').length, poly.length);
  });
});
