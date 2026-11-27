/**
 * Character biography, notes tree and chronicle helpers (Epic 10): seeding
 * from a .pcg, keeping GM-only notes out of the shared build, safe tree
 * walking and JSON export. Pure functions shared by client, server and tests.
 */
import {
  BIO_FIELD_MAX,
  BIO_TEXT_MAX,
  EMPTY_BIO_FIELDS,
  MAX_CHARACTER_NOTES,
  MAX_CHRONICLES,
  NOTE_BODY_MAX,
  NOTE_TITLE_MAX,
  type BioFields,
  type Character,
  type CharacterBio,
  type CharacterNote,
  type ChronicleEntry,
} from '../entities/pf1e';
import type { PcgenCharacter, PcgenNote, PcgenRawLine } from '../pcgen/schema';
import { AssetUrlSchema } from '../primitives';

const clip = (s: string | null | undefined, max: number) => (s ?? '').trim().slice(0, max);

/** PCGen's notes tab keeps GM notes under a root named "DM Notes" (its XML export skips it too). */
export function isDmNoteName(name: string): boolean {
  return /^\s*dm[\s_-]*notes\s*$/i.test(name);
}

function pcgNoteKey(n: PcgenNote, i: number) {
  return n.id === null ? `idx${i}` : String(n.id);
}

/** Indices of .pcg notes inside a "DM Notes" subtree (cycle-safe). */
function dmNoteIndices(notes: readonly PcgenNote[]): Set<number> {
  const byId = new Map<number, number>();
  notes.forEach((n, i) => {
    if (n.id !== null && !byId.has(n.id)) byId.set(n.id, i);
  });
  const out = new Set<number>();
  notes.forEach((_, i) => {
    const seen = new Set<number>();
    let cur: number | undefined = i;
    while (cur !== undefined && !seen.has(cur)) {
      seen.add(cur);
      const note: PcgenNote = notes[cur]!;
      if (isDmNoteName(note.name)) {
        out.add(i);
        return;
      }
      cur = note.parentId === null ? undefined : byId.get(note.parentId);
    }
  });
  return out;
}

/** True if a parsed build still carries GM-only notes (CHARACTERDMNOTES or a "DM Notes" note). */
export function buildHasDmNotes(build: PcgenCharacter): boolean {
  return !!build.bio.dmNotes?.trim() || build.notes.some((n) => isDmNoteName(n.name)) || dmNoteIndices(build.notes).size > 0;
}

/**
 * Move GM-only notes out of a parsed build: the build is visible to everyone
 * who sees the character, so it must never hold them. Returns the cleaned
 * build and the GM notes as text (for `bio.dmNotes`, GM imports only).
 */
export function splitDmNotes(build: PcgenCharacter): { build: PcgenCharacter; dmNotes: string } {
  const dm = dmNoteIndices(build.notes);
  const parts: string[] = [];
  if (build.bio.dmNotes?.trim()) parts.push(build.bio.dmNotes.trim());
  build.notes.forEach((n, i) => {
    if (!dm.has(i) || (isDmNoteName(n.name) && !n.value.trim())) return;
    parts.push(isDmNoteName(n.name) ? n.value.trim() : `${n.name}: ${n.value}`.trim());
  });
  return {
    build: { ...build, bio: { ...build.bio, dmNotes: null }, notes: build.notes.filter((_, i) => !dm.has(i)) },
    dmNotes: parts.join('\n\n').slice(0, BIO_TEXT_MAX),
  };
}

/** 72 (inches) -> 6' 0" */
function formatHeight(inches: number | null): string {
  if (inches === null || !Number.isFinite(inches) || inches <= 0) return '';
  const total = Math.round(inches);
  return `${Math.floor(total / 12)}' ${total % 12}"`;
}

function seedFields(build: PcgenCharacter): BioFields {
  const b = build.bio;
  const join = (sep: string, ...xs: (string | null | undefined)[]) => [...new Set(xs.map((x) => x?.trim()).filter(Boolean))].join(sep);
  const raw: Record<keyof BioFields, string> = {
    gender: b.gender ?? '',
    age: b.age !== null && Number.isFinite(b.age) ? String(b.age) : '',
    height: formatHeight(b.height),
    weight: b.weight !== null && Number.isFinite(b.weight) && b.weight > 0 ? `${b.weight} lb` : '',
    eyes: b.eyeColor ?? '',
    hair: join(', ', b.hairColor, b.hairStyle),
    skin: b.skinColor ?? '',
    handedness: b.handed ?? '',
    deity: build.attributes.deity?.name ?? '',
    homeland: build.attributes.region ?? '',
    birthplace: b.birthplace ?? '',
    birthday: b.birthday ?? '',
    location: join(', ', b.location, b.city),
    traits: join('; ', b.personalityTrait1, b.personalityTrait2),
    speechPattern: b.speechPattern ?? '',
    phobias: b.phobias ?? '',
    interests: b.interests ?? '',
    catchPhrase: b.catchPhrase ?? '',
  };
  const out = { ...EMPTY_BIO_FIELDS };
  for (const k of Object.keys(out) as (keyof BioFields)[]) out[k] = clip(raw[k], BIO_FIELD_MAX);
  return out;
}

/**
 * Turn .pcg NOTE lines into a valid notes forest: stable ids from the PCGen
 * ids (so re-import gives the same ids), orphans become roots, cycles are
 * broken, and the count / lengths are capped.
 */
export function seedNotes(notes: readonly PcgenNote[]): CharacterNote[] {
  const used = new Set<string>();
  const ids = notes.map((n, i) => {
    let id = `pcg-${pcgNoteKey(n, i).replace(/[^A-Za-z0-9_-]/g, 'm')}`;
    if (used.has(id)) id = `${id}-${i}`;
    used.add(id);
    return id;
  });
  const byPcgId = new Map<number, string>();
  notes.forEach((n, i) => {
    if (n.id !== null && !byPcgId.has(n.id)) byPcgId.set(n.id, ids[i]!);
  });
  const out: CharacterNote[] = notes.slice(0, MAX_CHARACTER_NOTES).map((n, i) => ({
    id: ids[i]!,
    parentId: n.parentId === null ? null : (byPcgId.get(n.parentId) ?? null),
    title: clip(n.name, NOTE_TITLE_MAX) || 'Untitled',
    body: (n.value ?? '').slice(0, NOTE_BODY_MAX),
  }));
  return repairNoteForest(out);
}

/** Make any list of notes a forest: unknown parents and cycle members become roots. */
export function repairNoteForest(notes: CharacterNote[]): CharacterNote[] {
  const out = notes.map((n) => ({ ...n, parentId: n.parentId === n.id ? null : n.parentId }));
  const byId = new Map(out.map((n) => [n.id, n]));
  for (const n of out) {
    if (n.parentId !== null && !byId.has(n.parentId)) n.parentId = null;
  }
  for (const n of out) {
    const seen = new Set<string>([n.id]);
    let cur = n.parentId;
    while (cur !== null) {
      if (seen.has(cur)) {
        n.parentId = null; // break the cycle here
        break;
      }
      seen.add(cur);
      cur = byId.get(cur)?.parentId ?? null;
    }
  }
  return out;
}

/** CHRONICLEENTRY:CAMPAIGN:x|ADVENTURE:y|PARTY:...|DATE:...|XP:...|GM:...|CHRONICLE:... */
export function parseChronicleLine(line: PcgenRawLine, id: string): ChronicleEntry {
  const entry: ChronicleEntry = { id, campaign: '', scenario: '', date: '', gm: '', party: '', xp: 0, gold: 0, fame: 0, notes: '' };
  const toks = line.tokens.map((t, i) => {
    if (i > 0 || t.tag !== 'CHRONICLEENTRY') return t;
    const c = t.value.indexOf(':');
    return c === -1 ? { tag: '', value: t.value } : { tag: t.value.slice(0, c), value: t.value.slice(c + 1) };
  });
  const num = (s: string, min: number, max: number) => {
    const n = Number(s.replace(/[,\s]|gp$/gi, ''));
    return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : 0;
  };
  for (const t of toks) {
    switch (t.tag.toUpperCase()) {
      case 'CAMPAIGN':
        entry.campaign = clip(t.value, 120);
        break;
      case 'ADVENTURE':
      case 'SCENARIO':
        entry.scenario = clip(t.value, 120);
        break;
      case 'DATE':
        entry.date = clip(t.value, 40);
        break;
      case 'GM':
        entry.gm = clip(t.value, 80);
        break;
      case 'PARTY':
        entry.party = clip(t.value, 200);
        break;
      case 'XP':
        entry.xp = Math.round(num(t.value, 0, 10_000_000));
        break;
      case 'GOLD':
        entry.gold = num(t.value, -1e9, 1e9);
        break;
      case 'FAME':
      case 'PRESTIGE':
        entry.fame = Math.round(num(t.value, -100000, 100000));
        break;
      case 'CHRONICLE':
      case 'NOTES':
        entry.notes = (t.value ?? '').slice(0, 4000);
        break;
      default:
        break;
    }
  }
  return entry;
}

/**
 * A biography seeded from a parsed (already DM-note-free) build. `dmNotes`
 * is only filled for GM imports.
 */
export function seedBio(raw: PcgenCharacter, dmNotes = ''): CharacterBio {
  const build = splitDmNotes(raw).build;
  const portrait = build.bio.portrait?.trim() ?? '';
  const portraitUrl = /^https?:\/\//i.test(portrait) && AssetUrlSchema.safeParse(portrait).success ? portrait : null;
  return {
    portraitUrl,
    pcgPortrait: portrait ? portrait.slice(0, 1000) : null,
    fields: seedFields(build),
    description: clip(build.bio.description, BIO_TEXT_MAX),
    biography: clip(build.bio.biography, BIO_TEXT_MAX),
    dmNotes: dmNotes.slice(0, BIO_TEXT_MAX),
    notes: seedNotes(build.notes),
    chronicles: build.chronicleEntries.slice(0, MAX_CHRONICLES).map((l, i) => parseChronicleLine(l, `pcg-chr-${i}`)),
  };
}

/** A .pcg portrait that is a local file path (C:\..., /home/..., file:...), which a browser can't load. */
export function isLocalPortraitPath(path: string | null): boolean {
  if (!path) return false;
  return !/^https?:\/\//i.test(path.trim());
}

// ------------------------------------------------------------------ notes tree

export interface NoteNode {
  note: CharacterNote;
  depth: number;
  children: NoteNode[];
}

/**
 * Build the visible tree. Never loops: every note is placed at most once;
 * notes whose parent is missing or that sit in a cycle are shown as roots.
 */
export function buildNoteTree(notes: readonly CharacterNote[], maxDepth = 32): NoteNode[] {
  const byParent = new Map<string | null, CharacterNote[]>();
  const ids = new Set(notes.map((n) => n.id));
  for (const n of notes) {
    const p = n.parentId !== null && ids.has(n.parentId) && n.parentId !== n.id ? n.parentId : null;
    byParent.set(p, [...(byParent.get(p) ?? []), n]);
  }
  const placed = new Set<string>();
  const build = (n: CharacterNote, depth: number): NoteNode => {
    placed.add(n.id);
    const kids = depth >= maxDepth ? [] : (byParent.get(n.id) ?? []).filter((k) => !placed.has(k.id));
    return { note: n, depth, children: kids.map((k) => (placed.has(k.id) ? null : build(k, depth + 1))).filter((x): x is NoteNode => !!x) };
  };
  const roots: NoteNode[] = [];
  for (const n of byParent.get(null) ?? []) if (!placed.has(n.id)) roots.push(build(n, 0));
  // Anything unreachable from a root (a cycle) becomes a root itself.
  for (const n of notes) if (!placed.has(n.id)) roots.push(build(n, 0));
  return roots;
}

/** Ids of a note's descendants (not including itself). Cycle-safe. */
export function noteDescendants(notes: readonly { id: string; parentId: string | null }[], id: string): Set<string> {
  const out = new Set<string>();
  const queue = [id];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const n of notes) {
      if (n.parentId === cur && n.id !== id && !out.has(n.id)) {
        out.add(n.id);
        queue.push(n.id);
      }
    }
  }
  return out;
}

/** Plain-text outline of a subtree (or the whole tree) for pasting into the Notepad. */
export function formatNotesText(notes: readonly CharacterNote[], rootId?: string, heading?: string): string {
  const tree = buildNoteTree(notes);
  const find = (nodes: NoteNode[]): NoteNode | undefined => {
    for (const n of nodes) {
      if (n.note.id === rootId) return n;
      const hit = find(n.children);
      if (hit) return hit;
    }
    return undefined;
  };
  const start = rootId ? find(tree) : undefined;
  const roots = rootId ? (start ? [start] : []) : tree;
  const lines: string[] = heading ? [heading, ''] : [];
  const walk = (n: NoteNode, depth: number) => {
    lines.push(`${'#'.repeat(Math.min(depth + 1, 6))} ${n.note.title}`);
    if (n.note.body.trim()) lines.push(n.note.body.trim());
    lines.push('');
    for (const k of n.children) walk(k, depth + 1);
  };
  for (const r of roots) walk(r, 0);
  return lines.join('\n').trimEnd();
}

// ------------------------------------------------------------------ export

export const CHARACTER_EXPORT_FORMAT = 'pf1e-vtt-character' as const;

/** The character as a downloadable JSON document. GM-only notes are left out unless `includeDmNotes`. */
export function exportCharacter(c: Character, opts: { includeDmNotes: boolean; now: number }) {
  const character: Character = opts.includeDmNotes ? c : { ...c, bio: { ...c.bio, dmNotes: '' } };
  return { format: CHARACTER_EXPORT_FORMAT, version: 1, exportedAt: new Date(opts.now).toISOString(), character };
}
