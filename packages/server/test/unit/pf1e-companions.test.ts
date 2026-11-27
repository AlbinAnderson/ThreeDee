import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  adjacentPosition,
  canonicalTrick,
  clampToScene,
  companionLinkProblem,
  companionTypeFromPcgen,
  companionsOf,
  computeCharacterStats,
  createScene,
  createToken,
  defaultLink,
  handleAnimalCheck,
  hpLinkName,
  isWounded,
  parsePcg,
  tricksFromBuild,
  type Character,
  type CompanionType,
} from '@vtt/shared';
import { makePcgCharacter, SAMPLE_PCG, withPcgLines } from '../helpers/harness';

function companionOf(id: string, masterId: string, type: CompanionType = 'animalCompanion', extra: Partial<NonNullable<Character['companion']>> = {}): Character {
  return {
    ...makePcgCharacter(undefined, { id }),
    name: id,
    companion: { masterId, type, knownTricks: [], link: defaultLink(type), harbored: false, stash: null, ...extra },
  };
}

describe('[Epic 9] companion rules (pure)', () => {
  test('PCGen follower TYPEs map to companion types, ignoring level suffixes and case', () => {
    assert.equal(companionTypeFromPcgen('Animal Companion 7'), 'animalCompanion');
    assert.equal(companionTypeFromPcgen('animal companion'), 'animalCompanion');
    assert.equal(companionTypeFromPcgen('Familiar'), 'familiar');
    assert.equal(companionTypeFromPcgen('Cavalier Mount'), 'mount');
    assert.equal(companionTypeFromPcgen('Special Mount'), 'mount');
    assert.equal(companionTypeFromPcgen('Eidolon 2'), 'eidolon');
    assert.equal(companionTypeFromPcgen('Undead Phantom'), 'phantom');
    assert.equal(companionTypeFromPcgen('Follower'), 'cohort');
    // No substring matching: these aren't familiars/mounts.
    assert.equal(companionTypeFromPcgen('Homunculus Companion'), 'other');
    assert.equal(companionTypeFromPcgen('Familiar Spirit Thing'), 'other');
    assert.equal(companionTypeFromPcgen(null), 'other');
  });

  test('Link defaults on for animal companions and mounts only; HP links only for eidolons and phantoms', () => {
    assert.equal(defaultLink('animalCompanion'), true);
    assert.equal(defaultLink('mount'), true);
    assert.equal(defaultLink('familiar'), false);
    assert.equal(hpLinkName('eidolon'), 'Life Link');
    assert.equal(hpLinkName('phantom'), 'Etheric Tether');
    assert.equal(hpLinkName('familiar'), null);
  });

  test('tricks: canonical spelling for core tricks, read from Animal Trick abilities in a .pcg', () => {
    assert.equal(canonicalTrick('  heel '), 'Heel');
    assert.equal(canonicalTrick('attack ii'), 'Attack II');
    assert.equal(canonicalTrick('Break Out'), 'Break Out');
    const build = parsePcg(
      withPcgLines(
        SAMPLE_PCG,
        'ABILITY:Animal Trick|TYPE:AnimalTrick|CATEGORY:Special Ability|NATURE:NORMAL|KEY:Animal Trick ~ Heel|APPLIEDTO:',
        'ABILITY:Animal Trick|TYPE:AnimalTrick|CATEGORY:Special Ability|NATURE:NORMAL|KEY:Animal Trick ~ attack|APPLIEDTO:',
        'ABILITY:Animal Trick|TYPE:AnimalTrick|CATEGORY:Special Ability|NATURE:NORMAL|KEY:Animal Trick ~ Heel|APPLIEDTO:',
      ),
    );
    assert.deepEqual(tricksFromBuild(build), ['Heel', 'Attack']);
  });

  test('link problems: self-links and cycles of any length are refused', () => {
    const a = makePcgCharacter(undefined, { id: 'a' });
    const b = companionOf('b', 'a');
    const c = companionOf('c', 'b');
    const state = { characters: { a, b, c } };
    assert.notEqual(companionLinkProblem(state, 'a', 'a'), true);
    assert.notEqual(companionLinkProblem(state, 'a', 'b'), true); // A -> B -> A
    assert.notEqual(companionLinkProblem(state, 'a', 'c'), true); // A -> C -> B -> A
    assert.equal(companionLinkProblem(state, 'c', 'a'), true); // moving C to A is fine
    assert.deepEqual(companionsOf(state, 'a').map((x) => x.id), ['b']);
  });

  test('Handle Animal: DC 10 handle / 25 push, +2 wounded; Link makes handle free and push a move, +4', () => {
    const master = makePcgCharacter(undefined, { id: 'm' });
    const linked = companionOf('rex', 'm', 'animalCompanion');
    const plain = companionOf('mule', 'm', 'other');
    const tokens = {};
    const h = handleAnimalCheck({ tokens }, master, linked, 'handle');
    assert.equal(h.dc, 10);
    assert.equal(h.cost, 'free');
    assert.equal(h.linkBonus, 4);
    assert.equal(h.bonus, h.skill + 4);
    assert.equal(handleAnimalCheck({ tokens }, master, linked, 'push').cost, 'move');
    assert.equal(handleAnimalCheck({ tokens }, master, linked, 'push').dc, 25);
    assert.equal(handleAnimalCheck({ tokens }, master, plain, 'handle').cost, 'move');
    assert.equal(handleAnimalCheck({ tokens }, master, plain, 'push').cost, 'fullRound');
    assert.equal(handleAnimalCheck({ tokens }, master, plain, 'push').linkBonus, 0);

    const max = computeCharacterStats(linked).hp.total;
    const hurt = { ...linked, runtime: { ...linked.runtime, hp: { current: max - 1, temp: 0, nonlethal: 0 } } };
    assert.equal(isWounded({ tokens }, hurt), true);
    assert.equal(handleAnimalCheck({ tokens }, master, hurt, 'push').dc, 27);
    const nonlethal = { ...linked, runtime: { ...linked.runtime, hp: { current: max, temp: 0, nonlethal: 2 } } };
    assert.equal(isWounded({ tokens }, nonlethal), true);
    const drained = { ...linked, runtime: { ...linked.runtime, abilityDamage: { STR: 1 } } };
    assert.equal(isWounded({ tokens }, drained), true);
    assert.equal(isWounded({ tokens }, linked), false);
    // A linked token's HP is the live value.
    const onToken = { ...linked, tokenId: 't' };
    const t = createToken({ id: 't', sceneId: 's', x: 0, y: 0, hp: { value: 3, max: 10, temp: 0 } });
    assert.equal(isWounded({ tokens: { t } }, onToken), true);
  });

  test('placement: next to the master, inside the scene bounds', () => {
    const scene = createScene('s'); // 30 x 20 cells of 70px
    assert.deepEqual(adjacentPosition(scene, { x: 140, y: 140, size: 1 }, 1), { x: 210, y: 140 });
    // At the right edge it goes to the left instead.
    assert.deepEqual(adjacentPosition(scene, { x: scene.width - 70, y: 0, size: 1 }, 1), { x: scene.width - 140, y: 0 });
    // A large companion next to a bottom-edge master stays on the map.
    const p = adjacentPosition(scene, { x: 0, y: scene.height - 70, size: 1 }, 2);
    assert.ok(p.y + 140 <= scene.height);
    assert.deepEqual(clampToScene(scene, -500, 99999, 1), { x: 0, y: scene.height - 70 });
  });
});
