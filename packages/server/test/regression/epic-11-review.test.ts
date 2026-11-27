/**
 * Epic 11 Layer-2 review regressions:
 *  - rules pack builder follows real PCGen 6 semantics (spell-item EQMODs, additive /
 *    conditional DESC, SCHOOL, .MOD citations, cross-publisher isolation, deferred
 *    COPY -> MOD -> FORGET, first definition wins, PRETOTALAB / PREVARGTEQ prereqs);
 *  - buying an item the pack has no price for is refused (no free magic items);
 *  - the AoN fetcher caps streamed bodies, times out slow bodies, skips unsupported
 *    pages before fetching, and remembers redirect targets in its cache.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, test } from 'node:test';
import { characterActions, createInitialState, inventoryActions, type EquipmentRecord, type FeatRecord, type SpellRecord } from '@vtt/shared';
import { Room } from '../../src/rooms/Room';
import { AonFetcher, type FetchLike } from '../../src/rules/aon';
import { buildRulesPack } from '../../src/rules/buildPack';
import { createRulesPackStore } from '../../src/rules/packStore';
import { SqliteRoomStore } from '../../src/persistence/SqliteRoomStore';
import { ALICE, createTestClient, GM_USER, makePcgCharacter, SAMPLE_PCG } from '../helpers/harness';

const tmpDirs: string[] = [];
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0)) await fn();
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});
function makeTmp(prefix: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

const pcc = (key: string, publisher: string, files: string[]) =>
  [`CAMPAIGN:${key}`, `KEY:${key}`, `SOURCELONG:${key}`, `SOURCESHORT:${key.slice(0, 3)}`, `PUBNAMELONG:${publisher}`, ...files].join('\n');

/** A small PCGen tree using real PCGen 6 line syntax (copied from the Core Rulebook .lst files). */
function buildPack() {
  const dir = makeTmp('epic11-review-');
  const pf = path.join(dir, 'pathfinder');
  const out = path.join(dir, 'pack');
  fs.mkdirSync(pf, { recursive: true });
  const w = (f: string, lines: string[]) => fs.writeFileSync(path.join(pf, f), lines.join('\n'));

  w('cr.pcc', [pcc('Core Rulebook', 'Paizo Inc.', ['EQUIPMENT:cr_e.lst', 'SPELL:cr_s.lst', 'ABILITY:cr_f.lst', 'DEITY:cr_d.lst'])]);
  w('cr_e.lst', [
    'Potion\tKEY:Potion\tTYPE:Magic.Potion',
    'Potion.COPY=Potion of Cure Light Wounds\tKEY:Potion of Cure Light Wounds\tTYPE:Magic.Potion.Consumable\tWT:0\tEQMOD:Special Ability ~ Spell Effect / Single Use|SPELLNAME[Cure Light Wounds]SPELLLEVEL[1]CASTERLEVEL[1]\tSOURCEPAGE:p.477\tQUALITY:Caster Level|1st',
    'Wand of Magic Missile (CL 1)\tTYPE:Magic.Wand\tCOST:0\tEQMOD:Special Ability ~ Spell Effect / Spell Trigger|SPELLNAME[Magic Missile] CASTER[Wizard] SPELLTYPE[Arcane] SPELLLEVEL[1] CASTERLEVEL[1] CHARGES[50]',
    'Scroll of Fireball\tTYPE:Magic.Scroll\tCOST:0\tEQMOD:Special Ability ~ Spell Effect / Completion / Scroll / Arcane|SPELLNAME[Fireball]SPELLLEVEL[3]CASTERLEVEL[5]',
    'Amulet of Mighty Fists +1\tTYPE:Magic.Wondrous\tCOST:0\tWT:0',
    'Chain Shirt\tTYPE:Armor.Light\tCOST:100\tWT:25\tSOURCEPAGE:p.150',
    'Arrows (20)\tKEY:Arrows (20)\tTYPE:Ammunition.Arrow.Stack\tCOST:1\tWT:3\tBASEQTY:20',
  ]);
  w('cr_s.lst', [
    'Fireball\tSCHOOL:Evocation\tCLASSES:Sorcerer,Wizard=3\tSOURCEPAGE:p.283\tDESC:Deals (min(10,CASTERLEVEL))d6 fire damage.|!PRERULE:1,DisplayFullSpell',
    'Fireball.MOD\tDESC:A fireball spell generates a searing explosion of flame.|PRERULE:1,DisplayFullSpell',
  ]);
  w('cr_f.lst', [
    'Power Attack\tCATEGORY:FEAT\tTYPE:Combat\tPRETOTALAB:1\tPREVARGTEQ:PreStatScore_STR,13\tSOURCEPAGE:p.131\tBENEFIT:Take a -%1 penalty (+50%% two-handed).',
  ]);
  w('cr_d.lst', ['Iomedae\tALIGN:LG\tDEITYWEAP:Longsword\tSOURCEPAGE:p.45\tDESC:Goddess of valor.']);

  // A Paizo supplement: elemental SCHOOL tag, mythic DESC, a citation-only .MOD, and a
  // .MOD aimed at a book that loads after it alphabetically ("Zz Late Book").
  w('apg.pcc', [pcc('Advanced Players Guide', 'Paizo Publishing', ['SPELL:apg_s.lst', 'EQUIPMENT:apg_e.lst', 'DEITY:apg_d.lst'])]);
  w('apg_s.lst', [
    'Fireball.MOD\tSCHOOL:FireSchool',
    'Fireball.MOD\tDESC:Mythic: 1d10 per level.|PREABILITY:1,CATEGORY=Mythic Spell,Fireball',
  ]);
  w('apg_e.lst', ['Chain Shirt.MOD\tCOST:100\tWT:25\tSOURCEPAGE:p.10', 'Late Lantern.MOD\tCOST:12']);
  w('apg_d.lst', ['Iomedae\tALIGN:LG\tDEITYWEAP:Longsword\tSOURCEPAGE:p.25\tDESC:Duplicate from a later book.']);
  w('zz.pcc', [pcc('Zz Late Book', 'Paizo Inc.', ['EQUIPMENT:zz_e.lst'])]);
  w('zz_e.lst', ['Late Lantern\tTYPE:Goods\tCOST:7\tWT:1']);

  // A third-party book adds its class to a Core spell and forgets a Core feat: refused.
  w('tp.pcc', [pcc('Third Party Book', 'Super Genius Games', ['SPELL:tp_s.lst', 'ABILITY:tp_f.lst'])]);
  w('tp_s.lst', ['Fireball.MOD\tCLASSES:Archon=3', 'Ember\tSCHOOL:Evocation\tCLASSES:Archon=1']);
  w('tp_f.lst', ['CATEGORY=FEAT|Power Attack.MOD\tBENEFIT:.CLEAR', 'Power Attack.FORGET']);

  const { manifest } = buildRulesPack(pf, out);
  return { manifest, store: createRulesPackStore(out), out, dir };
}

describe('[Epic 11 review] rules pack builder follows PCGen semantics', () => {
  test('spell-item EQMODs (SPELLNAME[..]SPELLLEVEL[..]CASTERLEVEL[..]) price potions, wands and scrolls', () => {
    const { store } = buildPack();
    const potion = store.get('equipment', 'Potion of Cure Light Wounds')!;
    assert.deepEqual(potion.spellEffect, { name: 'Cure Light Wounds', level: 1, cl: 1 });
    const hits = store.search({ kind: 'equipment', q: '', allowedSources: null, customRules: {}, isGm: true, limit: 100 });
    const cost = (n: string) => hits.find((h) => h.name === n)?.cost;
    assert.equal(cost('Potion of Cure Light Wounds'), 50);
    assert.equal(cost('Wand of Magic Missile (CL 1)'), 750);
    assert.equal(cost('Scroll of Fireball'), 375);
    assert.equal(cost('Amulet of Mighty Fists +1'), null, 'COST:0 magic item: unknown price, not free');
    assert.equal(store.get('equipment', 'Arrows (20)')!.baseQty, 20);
  });

  test('DESC is additive and conditional: full text wins, mythic riders are dropped; first SCHOOL wins', () => {
    const { store } = buildPack();
    const fb = store.get('spell', 'Fireball') as SpellRecord;
    assert.equal(fb.desc, 'A fireball spell generates a searing explosion of flame.');
    assert.equal(fb.school, 'Evocation');
    assert.deepEqual(fb.classes, { Sorcerer: 3, Wizard: 3 }, 'third-party .MOD class lists stay out of Paizo spells');
  });

  test('a .MOD keeps the record citation; .MODs apply after every book loads; first definition wins', () => {
    const { store } = buildPack();
    const shirt = store.get('equipment', 'Chain Shirt') as EquipmentRecord;
    assert.equal(shirt.source.campaign, 'Core Rulebook');
    assert.equal(shirt.source.page, 'p.150');
    assert.equal((store.get('equipment', 'Late Lantern') as EquipmentRecord).cost, 12);
    const io = store.byName('deity', 'Iomedae')!;
    assert.equal(io.source.campaign, 'Core Rulebook');
    assert.equal(io.desc, 'Goddess of valor.');
  });

  test('third-party .MOD/.FORGET cannot change other publishers’ records; PCGen 6 prereqs are summarised', () => {
    const { store, manifest } = buildPack();
    const pa = store.byName('feat', 'Power Attack') as FeatRecord;
    assert.ok(pa, 'Power Attack survives the third-party .FORGET');
    assert.equal(pa.benefit, 'Take a -X penalty (+50% two-handed).');
    assert.equal(pa.prereqs, 'BAB +1; STR 13');
    assert.ok(store.byName('spell', 'Ember'), 'third-party records of their own still load');
    assert.ok(manifest.warnings.some((w) => /Ignored 3 \.MOD\/\.FORGET/.test(w)), manifest.warnings.join('; '));
  });
});

describe('[Epic 11 review] shopping never sells unpriced items for free', () => {
  test('inventory/buyItem rejects a COST:0 magic item; "Add free" is the explicit path', async () => {
    const { store, dir } = buildPack();
    const db = new SqliteRoomStore(path.join(dir, 'vtt.db'));
    const room = new Room('r1', createInitialState('scene1'), db, undefined, () => store);
    cleanups.push(async () => {
      await room.flush();
      db.close();
    });
    const gm = createTestClient();
    const alice = createTestClient();
    room.join(gm, GM_USER);
    room.join(alice, ALICE);
    let n = 0;
    const act = (c: typeof alice, a: Parameters<Room['handleClientAction']>[2]) => room.handleClientAction(c, `c${n++}`, a);
    act(alice, characterActions.import.create({ character: makePcgCharacter(SAMPLE_PCG, { id: 'val', ownerId: ALICE.id }) }));
    act(alice, inventoryActions.setCoins.create({ characterId: 'val', coins: { pp: 0, gp: 100, sp: 0, cp: 0 } }));
    assert.deepEqual(alice.rejects(), []);

    act(alice, inventoryActions.buyItem.create({ characterId: 'val', itemId: 'amu', quantity: 1, ruleKey: 'Amulet of Mighty Fists +1' }));
    assert.match(alice.rejects()[0] ?? '', /no price/);
    assert.equal(room.currentState.characters.val!.inventory.items.some((i) => i.id === 'amu'), false);

    act(alice, inventoryActions.buyItem.create({ characterId: 'val', itemId: 'clw', quantity: 2, ruleKey: 'Potion of Cure Light Wounds' }));
    assert.equal(alice.rejects().length, 1);
    assert.equal(room.currentState.characters.val!.inventory.coins.gp, 0, '2 potions of CLW = 100 gp');
  });
});

describe('[Epic 11 review] AoN fetcher hardening (offline, mocked fetch)', () => {
  const page = '<html><body><h1 class="title">Fireball</h1><b>School</b> evocation [fire]; <b>Level</b> sorcerer/wizard 3<h3 class="framing">Description</h3>Boom.</body></html>';

  test('streamed bodies over the cap are rejected (no content-length) and never cached', async () => {
    const cacheDir = makeTmp('aon-cap-');
    const big = new Uint8Array(4096).fill(65);
    const fetchFn: FetchLike = async () =>
      new Response(
        new ReadableStream({
          start(c) {
            for (let i = 0; i < 10; i++) c.enqueue(big);
            c.close();
          },
        }),
        { status: 200 },
      );
    const f = new AonFetcher({ cacheDir, fetchFn, minIntervalMs: 0, maxBytes: 16_384 });
    await assert.rejects(f.lookup({ url: 'https://www.aonprd.com/SpellDisplay.aspx?ItemName=Fireball' }), /maximum size/);
    assert.deepEqual(fs.existsSync(cacheDir) ? fs.readdirSync(cacheDir) : [], []);
  });

  test('the timeout covers a body that never finishes', async () => {
    const fetchFn: FetchLike = async (_url, init) =>
      new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(new TextEncoder().encode('<html>'));
            init?.signal?.addEventListener('abort', () => c.error(new Error('aborted')));
          },
        }),
        { status: 200 },
      );
    const f = new AonFetcher({ cacheDir: makeTmp('aon-slow-'), fetchFn, minIntervalMs: 0, timeoutMs: 50 });
    await assert.rejects(f.lookup({ url: 'https://www.aonprd.com/SpellDisplay.aspx?ItemName=Fireball' }), /too long/);
  });

  test('unsupported page types are refused before any request (rate limit and cache untouched)', async () => {
    let calls = 0;
    const fetchFn: FetchLike = async () => {
      calls++;
      return new Response(page);
    };
    const f = new AonFetcher({ cacheDir: makeTmp('aon-kind-'), fetchFn, minIntervalMs: 0 });
    await assert.rejects(f.lookup({ url: 'https://www.aonprd.com/ClassDisplay.aspx?ItemName=Fighter' }), /Unsupported/);
    assert.equal(calls, 0);
  });

  test('a cached redirect keeps its final URL (and stays on the allowlist)', async () => {
    const cacheDir = makeTmp('aon-redir-');
    const seen: string[] = [];
    const fetchFn: FetchLike = async (url) => {
      seen.push(url);
      if (url.includes('ItemName=Fire%20Ball')) {
        return new Response(null, { status: 302, headers: { location: '/SpellDisplay.aspx?ItemName=Fireball' } });
      }
      return new Response(page);
    };
    const f = new AonFetcher({ cacheDir, fetchFn, minIntervalMs: 0 });
    const first = await f.lookup({ url: 'https://www.aonprd.com/SpellDisplay.aspx?ItemName=Fire%20Ball' });
    assert.equal(first.url, 'https://www.aonprd.com/SpellDisplay.aspx?ItemName=Fireball');
    const second = await f.lookup({ url: 'https://www.aonprd.com/SpellDisplay.aspx?ItemName=Fire%20Ball' });
    assert.equal(second.cached, true);
    assert.equal(second.url, first.url);
    assert.equal(seen.length, 2, 'second lookup served from cache');
  });
});

describe('[Epic 11 review] catalog search ranking', () => {
  test('the canonical record ranks above .COPY variants; Internal PCGen abilities are not listed', () => {
    const dir = makeTmp('epic11-rank-');
    const pf = path.join(dir, 'pathfinder');
    fs.mkdirSync(pf, { recursive: true });
    fs.writeFileSync(path.join(pf, 'cr.pcc'), pcc('Core Rulebook', 'Paizo Inc.', ['SPELL:s.lst', 'ABILITY:a.lst']));
    fs.writeFileSync(path.join(pf, 'oa.pcc'), pcc('Occult Adventures', 'Paizo Inc.', ['SPELL:oa.lst']));
    fs.writeFileSync(path.join(pf, 's.lst'), 'Fireball\tSCHOOL:Evocation\tCLASSES:Wizard=3');
    fs.writeFileSync(path.join(pf, 'oa.lst'), 'Fireball.COPY=Occultist Spell ~ Fireball\tOUTPUTNAME:Fireball');
    fs.writeFileSync(path.join(pf, 'a.lst'), 'Fireball\tKEY:Sorcerer Bonus Spell L3 ~ Fireball\tCATEGORY:Internal');
    buildRulesPack(pf, path.join(dir, 'pack'));
    const store = createRulesPackStore(path.join(dir, 'pack'));
    const hits = store.search({ q: 'Fireball', allowedSources: null, customRules: {}, isGm: true });
    assert.deepEqual(
      hits.map((h) => h.key),
      ['Fireball', 'Occultist Spell ~ Fireball'],
    );
  });
});
