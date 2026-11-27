import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  appendedNote,
  buildHasDmNotes,
  buildNoteTree,
  CharacterNotesSchema,
  comparePcgenXml,
  computeCharacterStats,
  createCharacterFromPcg,
  decodeXmlEntities,
  exportCharacter,
  formatNotesText,
  isLocalPortraitPath,
  isNoteForest,
  noteDescendants,
  parseBaseXml,
  parsePcg,
  parseXml,
  repairNoteForest,
  seedBio,
  seedNotes,
  splitDmNotes,
  XmlParseError,
  type CharacterNote,
} from '@vtt/shared';
import { makePcgCharacter, SAMPLE_PCG, withPcgLines } from '../helpers/harness';

describe('[Epic 10] unit: bio seeding from .pcg', () => {
  test('CHARACTER* fields, notes tree and chronicle are seeded from the sample file', () => {
    const bio = seedBio(parsePcg(SAMPLE_PCG));
    assert.equal(bio.fields.gender, 'Male');
    assert.equal(bio.fields.age, '24');
    assert.equal(bio.fields.height, `6' 0"`);
    assert.equal(bio.fields.weight, '190 lb');
    assert.equal(bio.fields.hair, 'Brown, Short');
    assert.equal(bio.fields.eyes, 'Brown');
    assert.equal(bio.fields.handedness, 'Right');
    assert.equal(bio.fields.deity, 'Cayden Cailean');
    assert.equal(bio.fields.homeland, 'Varisia');
    assert.equal(bio.fields.location, 'Sandpoint', 'LOCATION and CITY are de-duplicated');
    assert.equal(bio.fields.traits, 'Loyal: never leaves an ally; Enjoys a good ale');
    assert.match(bio.description, /Broad-shouldered fighter\nCarries two blades\./);
    assert.match(bio.biography, /Born in Andoran/);
    assert.equal(bio.pcgPortrait, '/portraits/valeros.png');
    assert.equal(bio.portraitUrl, null, 'a local PCGen path is not used as a URL');
    assert.ok(isLocalPortraitPath(bio.pcgPortrait));
    assert.ok(!isLocalPortraitPath('https://example.com/a.png'));

    assert.deepEqual(
      bio.notes.map((n) => [n.id, n.parentId, n.title]),
      [
        ['pcg-0', null, 'Session Notes'],
        ['pcg-1', 'pcg-0', 'Goblin Loot'],
      ],
    );
    assert.match(bio.notes[0]!.body, /Fought goblins: won!/);
    assert.equal(bio.chronicles.length, 1);
    assert.equal(bio.chronicles[0]!.campaign, 'Rise of the Runelords');
    assert.equal(bio.chronicles[0]!.scenario, 'Burnt Offerings');
    assert.equal(bio.dmNotes, '');
  });

  test('chronicle lines with PCGen’s full tag set parse XP, GM, party and the chronicle text', () => {
    const build = parsePcg(withPcgLines(SAMPLE_PCG, 'CHRONICLEENTRY:EXPORT:Y|CAMPAIGN:PFS|ADVENTURE:The Silver Mount|PARTY:Ezren, Kyra|DATE:2026-01-02|XP:3|GM:Sam|GOLD:1,250.5|FAME:2|CHRONICLE:Found the key'));
    const e = seedBio(build).chronicles[1]!;
    assert.deepEqual(
      { ...e, id: undefined },
      { id: undefined, campaign: 'PFS', scenario: 'The Silver Mount', date: '2026-01-02', gm: 'Sam', party: 'Ezren, Kyra', xp: 3, gold: 1250.5, fame: 2, notes: 'Found the key' },
    );
  });

  test('GM notes (CHARACTERDMNOTES and a "DM Notes" note subtree) move out of the build', () => {
    const raw = parsePcg(
      withPcgLines(SAMPLE_PCG, 'CHARACTERDMNOTES:secretDmNote one', 'NOTE:DM Notes|ID:5|PARENTID:-1|VALUE:secretDmNote two', 'NOTE:Twist|ID:6|PARENTID:5|VALUE:secretDmNote three'),
    );
    assert.ok(buildHasDmNotes(raw));
    const { build, dmNotes } = splitDmNotes(raw);
    assert.ok(!buildHasDmNotes(build));
    assert.doesNotMatch(JSON.stringify(build), /secretDmNote/);
    assert.match(dmNotes, /one[\s\S]*two[\s\S]*Twist: secretDmNote three/);
    // createCharacterFromPcg keeps them only in bio.dmNotes, never in the build or the notes tree.
    const c = createCharacterFromPcg(raw, { id: 'x', ownerId: null, fileName: 'x.pcg', importedBy: 'gm1', now: 1 });
    assert.doesNotMatch(JSON.stringify({ ...c, bio: { ...c.bio, dmNotes: '' } }), /secretDmNote/);
    assert.match(c.bio.dmNotes, /secretDmNote one/);
    // Export strips them unless asked.
    assert.doesNotMatch(JSON.stringify(exportCharacter(c, { includeDmNotes: false, now: 0 })), /secretDmNote/);
    assert.match(JSON.stringify(exportCharacter(c, { includeDmNotes: true, now: 0 })), /secretDmNote/);
  });

  test('orphaned, duplicate and cyclic .pcg notes become a valid forest', () => {
    const build = parsePcg(
      withPcgLines(
        SAMPLE_PCG,
        'NOTE:Orphan|ID:10|PARENTID:99|VALUE:x',
        'NOTE:A|ID:11|PARENTID:12|VALUE:',
        'NOTE:B|ID:12|PARENTID:11|VALUE:',
        'NOTE:Self|ID:13|PARENTID:13|VALUE:',
        'NOTE:Dup|ID:1|PARENTID:-1|VALUE:',
        'NOTE:|VALUE:no id',
      ),
    );
    const notes = seedNotes(build.notes);
    assert.ok(isNoteForest(notes));
    assert.ok(CharacterNotesSchema.safeParse(notes).success);
    assert.equal(new Set(notes.map((n) => n.id)).size, notes.length);
    assert.equal(notes.find((n) => n.title === 'Orphan')!.parentId, null);
    assert.equal(notes.find((n) => n.title === 'Self')!.parentId, null);
    assert.equal(notes.find((n) => n.body === 'no id')!.title, 'Untitled');
  });
});

describe('[Epic 10] unit: notes tree helpers', () => {
  const n = (id: string, parentId: string | null, title = id): CharacterNote => ({ id, parentId, title, body: '' });

  test('buildNoteTree never loops and places every note exactly once, even with cycles', () => {
    const notes = [n('a', null), n('b', 'a'), n('c', 'b'), n('x', 'y'), n('y', 'x'), n('z', 'missing'), n('s', 's')];
    assert.ok(!isNoteForest(notes));
    const tree = buildNoteTree(notes);
    const seen: string[] = [];
    const walk = (ns: typeof tree) => ns.forEach((k) => (seen.push(k.note.id), walk(k.children)));
    walk(tree);
    assert.deepEqual([...seen].sort(), ['a', 'b', 'c', 's', 'x', 'y', 'z']);
    assert.ok(isNoteForest(repairNoteForest(notes)));
  });

  test('descendants and outline text', () => {
    const notes = [n('a', null, 'Root'), { ...n('b', 'a', 'Child'), body: 'hello' }, n('c', 'b', 'Grandchild'), n('d', null, 'Other')];
    assert.deepEqual([...noteDescendants(notes, 'a')].sort(), ['b', 'c']);
    assert.equal(formatNotesText(notes, 'b'), '# Child\nhello\n\n## Grandchild');
    assert.match(formatNotesText(notes, undefined, 'Hdr'), /^Hdr\n\n# Root\n\n## Child[\s\S]*# Other$/);
    assert.equal(appendedNote('', 'x'), 'x');
    assert.equal(appendedNote('old\n\n', 'x'), 'old\n\nx');
  });
});

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<!-- PCGen export -->
<character>
  <basics>
    <name>Valeros &amp; Friends</name>
    <playername>Pat</playername>
    <alignment><long>Neutral Good</long><short>NG</short></alignment>
    <race>Human</race>
    <bab>+1</bab>
    <classes><class><name>Fighter</name><level>1</level></class></classes>
    <move><move><name>Walk</name><rate>30'</rate></move></move>
    <description><![CDATA[Tall <and> scarred]]></description>
  </basics>
  <abilities>
    <ability><name><long>Strength</long><short>STR</short></name><score>17</score><modifier>+3</modifier></ability>
  </abilities>
  <hit_points><points>12</points></hit_points>
  <armor_class><total>18</total><flat>16</flat><touch>12</touch></armor_class>
  <initiative><total>+2</total></initiative>
  <skills><skill><name>Climb</name><ranks>1</ranks><skill_mod>+7<!-- c --></skill_mod></skill></skills>
  <saving_throws>
    <saving_throw><name><long>fortitude</long><short>fort</short></name><total>+4</total></saving_throw>
    <saving_throw><name><long>reflex</long><short>ref</short></name><total>&#43;2</total></saving_throw>
    <saving_throw><name><long>will</long><short>will</short></name><total>-1</total></saving_throw>
  </saving_throws>
  <attack><cmb><total>+4</total><defense>16</defense></cmb></attack>
  <weapons>
    <weapon><common><name><short>Longsword</short><output>Longsword +1</output></name><critical><range>19-20</range><multiplier>2</multiplier></critical><to_hit><total_hit>+5</total_hit></to_hit><damage>1d8+4</damage></common></weapon>
  </weapons>
  <spells><known_spells><class spelllistclass="Wizard" spellcasterlevel="1"><level number="1"><spell><name>Magic Missile</name></spell></level></class></known_spells></spells>
</character>`;

describe('[Epic 10] unit: PCGen base.xml parser', () => {
  test('extracts PCGen’s computed totals', () => {
    const s = parseBaseXml(XML);
    assert.equal(s.name, 'Valeros & Friends');
    assert.equal(s.alignment, 'Neutral Good');
    assert.equal(s.race, 'Human');
    assert.deepEqual(s.classes, [{ name: 'Fighter', level: 1 }]);
    assert.equal(s.bio.description, 'Tall <and> scarred');
    assert.deepEqual(s.abilities, [{ key: 'STR', score: 17, mod: 3 }]);
    assert.equal(s.hp, 12);
    assert.deepEqual(s.ac, { total: 18, touch: 12, flatFooted: 16 });
    assert.deepEqual(s.saves, { fort: 4, ref: 2, will: -1 });
    assert.equal(s.bab, 1);
    assert.equal(s.cmb, 4);
    assert.equal(s.cmd, 16);
    assert.equal(s.initiative, 2);
    assert.equal(s.speed, 30);
    assert.deepEqual(s.skills, [{ name: 'Climb', total: 7, ranks: 1 }]);
    assert.deepEqual(s.attacks, [{ name: 'Longsword +1', toHit: '+5', damage: '1d8+4', critical: '19-20/×2', range: '' }]);
    assert.deepEqual(s.spells, [{ className: 'Wizard', casterLevel: 1, levels: [{ level: 1, spells: ['Magic Missile'] }] }]);
  });

  test('compare: rows for every exported number, matched against the VTT engine', () => {
    const c = makePcgCharacter();
    const stats = computeCharacterStats(c);
    const rows = comparePcgenXml(parseBaseXml(XML), stats, new Map([['Climb', 7]]));
    const byLabel = new Map(rows.map((r) => [r.label, r]));
    assert.equal(byLabel.get('Climb')!.match, true);
    assert.equal(byLabel.get('AC')!.vtt, stats.ac.normal.total);
    assert.equal(byLabel.get('AC')!.pcgen, 18);
    assert.ok(byLabel.has('CMD') && byLabel.has('Will') && byLabel.has('STR'));
  });

  test('no entity expansion, no XXE: DOCTYPE and custom entities are never interpreted', () => {
    const bomb = `<?xml version="1.0"?>
<!DOCTYPE lolz [<!ENTITY lol "lol]><evil/>"><!ENTITY lol2 "&lol;&lol;&lol;&lol;"><!ENTITY xxe SYSTEM "file:///etc/passwd">]>
<character><basics><name>&lol2;&xxe;</name></basics></character>`;
    assert.equal(parseBaseXml(bomb).name, '&lol2;&xxe;');
    assert.equal(decodeXmlEntities('&#60;&#x3E;&amp;&bogus;&#0;&#xD800;'), '<>&&bogus;&#0;&#xD800;');
  });

  test('size, depth and element caps; malformed input throws a readable error', () => {
    assert.throws(() => parseXml('<a>' + 'x'.repeat(50) + '</a>', { maxChars: 20 }), XmlParseError);
    assert.throws(() => parseXml('<a>'.repeat(100), { maxDepth: 64 }), /nested too deeply/);
    assert.throws(() => parseXml('<a/>'.repeat(20), { maxElements: 10 }), /Too many/);
    assert.throws(() => parseXml('<a><!-- never closed'), /Unterminated comment/);
    assert.throws(() => parseBaseXml('<notpcgen/>'), /Not a PCGen XML export/);
    // Stray / mismatched close tags are tolerated.
    assert.equal(parseBaseXml('<character><basics><name>A</b></name></basics></x></character>').name, 'A');
  });
});
