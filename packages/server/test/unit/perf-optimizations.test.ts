import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import { visibilityPolygon, type Segment } from '@vtt/shared';
import { buildRulesPack } from '../../src/rules/buildPack';
import { RulesPackStore } from '../../src/rules/packStore';

describe('performance optimization behavioral parity', () => {
  test('visibilityPolygon culls out-of-bounds walls while keeping walls that intersect or lie inside bounds', () => {
    const insideWall: Segment = [50, -30, 50, 30];
    const crossingWall: Segment = [-200, 40, 200, 40];
    const farOutsideWall: Segment = [500, 500, 700, 700];
    const bounds = { minX: -100, minY: -100, maxX: 100, maxY: 100 };

    const withFar = visibilityPolygon({ x: 0, y: 0 }, [insideWall, crossingWall, farOutsideWall], bounds);
    const withoutFar = visibilityPolygon({ x: 0, y: 0 }, [insideWall, crossingWall], bounds);
    assert.deepEqual(withFar, withoutFar, 'out-of-bounds wall must not alter bounded visibility polygon');
    // Inside wall at x=50 must block rays toward x=100 at y=0.
    assert.ok(withFar.every((p) => !(Math.abs(p.y) < 1 && p.x > 50.5)), 'inside wall blocks ray at y=0');
    // Crossing wall at y=40 must block rays toward y=100 at x=0.
    assert.ok(withFar.every((p) => !(Math.abs(p.x) < 1 && p.y > 40.5)), 'crossing wall blocks ray at x=0');
  });

  test('RulesPackStore pre-indexed search matches empty queries, multi-token queries, allowedSources, and canonical priority', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vtt-perf-pack-'));
    try {
      const inDir = path.join(dir, 'in');
      const outDir = path.join(dir, 'out');
      fs.mkdirSync(inDir, { recursive: true });
      fs.writeFileSync(
        path.join(inDir, 'core.pcc'),
        ['CAMPAIGN:Core Rulebook', 'KEY:Core Rulebook', 'SOURCELONG:Core Rulebook', 'SOURCESHORT:CR', 'PUBNAMELONG:Paizo Inc.', 'BOOKTYPE:Core Rules', 'SPELL:spells.lst', 'ABILITY:abilities.lst'].join('\n'),
      );
      fs.writeFileSync(
        path.join(inDir, 'other.pcc'),
        ['CAMPAIGN:Extra Book', 'KEY:Extra Book', 'SOURCELONG:Extra Book', 'SOURCESHORT:EB', 'PUBNAMELONG:Paizo Inc.', 'BOOKTYPE:Supplement', 'SPELL:extra.lst'].join('\n'),
      );
      fs.writeFileSync(
        path.join(inDir, 'spells.lst'),
        'Fireball\tSCHOOL:Evocation\tCLASSES:Wizard=3\nFire Shield\tSCHOOL:Evocation\tCLASSES:Wizard=4\nHidden Spell\tVISIBLE:NO\tSCHOOL:Evocation\tCLASSES:Wizard=1\n',
      );
      fs.writeFileSync(path.join(inDir, 'extra.lst'), 'Fire Storm\tSCHOOL:Evocation\tCLASSES:Cleric=8\n');
      fs.writeFileSync(
        path.join(inDir, 'abilities.lst'),
        'Internal Helper\tCATEGORY:Internal\tDESC:Should never show in search\nFireball\tKEY:Occultist ~ Fireball\tCATEGORY:Special Ability\tDESC:Copy\n',
      );
      buildRulesPack(inDir, outDir);
      const store = new RulesPackStore(outDir);

      // Empty query returns only non-hidden, non-Internal entries respecting allowedSources.
      const emptyCore = store.search({ q: '', allowedSources: ['Core Rulebook'], customRules: {}, isGm: true, limit: 10 });
      assert.equal(emptyCore.some((h) => h.name === 'Hidden Spell' || h.name === 'Internal Helper' || h.name === 'Fire Storm'), false);
      assert.ok(emptyCore.some((h) => h.name === 'Fireball'));

      // Canonical record (KEY === name) ranks above copy ("Occultist ~ Fireball").
      const fireHits = store.search({ q: 'fireball', allowedSources: null, customRules: {}, isGm: true, limit: 10 });
      assert.equal(fireHits[0]!.key, 'Fireball');
      assert.equal(fireHits[1]!.key, 'Occultist ~ Fireball');

      // Multi-token query matches across name + types/key.
      const multi = store.search({ q: 'fire shield', allowedSources: ['Core Rulebook'], customRules: {}, isGm: true, limit: 10 });
      assert.deepEqual(
        multi.map((h) => h.name),
        ['Fire Shield'],
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
