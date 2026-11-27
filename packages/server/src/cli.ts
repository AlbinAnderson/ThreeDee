/**
 * Maintenance commands. Run from the repo root (-s hides npm's own output):
 *
 *   npm run -s vtt -- rooms                    list rooms
 *   npm run -s vtt -- snapshots <room>         list a room's snapshots
 *   npm run -s vtt -- backup [file]            consistent copy of the database (safe while running)
 *   npm run -s vtt -- export <room> [file]     room state as JSON
 *   npm run -s vtt -- import <file> <room>     load a JSON export into a room (stop the server first!)
 *   npm run -s vtt -- pcgen <file.pcg> [out]   convert a PCGen .pcg file to JSON (stdout if no out file)
 *   npm run -s vtt -- rules build <dir> [out]  build the PF1e rules pack from a PCGen data folder
 *   npm run -s vtt -- rules install <tgz> [out] validate & atomically install a rules pack archive
 *   npm run -s vtt -- rules rollback [out]     restore the previous rules pack backup
 *   npm run -s vtt -- rules status [out]       print the installed rules pack summary
 */
import fs from 'node:fs';
import path from 'node:path';
import { migrateState, parsePcgToJson, RoomIdSchema } from '@vtt/shared';
import { paths } from './config';
import { SqliteRoomStore } from './persistence/SqliteRoomStore';
import { buildRulesPack } from './rules/buildPack';
import { installRulesPack, rollbackRulesPack, validateRulesDir } from './rules/installPack';

/** Paths are relative to where the user ran npm, not this package. */
const resolveUserPath = (p: string) => path.resolve(process.env.INIT_CWD ?? process.cwd(), p);
/** Local time, e.g. 2026-11-25-2027. */
const stamp = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
};
const fmtDate = (ms: number) => new Date(ms).toLocaleString();

function usage(): never {
  console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('*/')[0]!.replace(/^\/\*\*?|^ \* ?/gm, ''));
  process.exit(1);
}

function roomArg(value: string | undefined): string {
  if (!value || !RoomIdSchema.safeParse(value).success) usage();
  return value;
}

const [command, ...args] = process.argv.slice(2);

if (command === 'pcgen') {
  try {
    if (!args[0]) usage();
    const inputPath = resolveUserPath(args[0]);
    const content = fs.readFileSync(inputPath, 'utf8');
    const json = parsePcgToJson(content, true);
    if (args[1]) {
      const outPath = resolveUserPath(args[1]);
      fs.writeFileSync(outPath, `${json}\n`);
      console.log(`Converted ${inputPath} -> ${outPath}`);
    } else {
      console.log(json);
    }
  } catch (e) {
    console.error((e as Error).message);
    process.exitCode = 1;
  }
  process.exit(process.exitCode ?? 0);
}

if (command === 'rules') {
  try {
    const sub = args[0];
    if (sub === 'build') {
      if (!args[1]) usage();
      const pcgenDir = resolveUserPath(args[1]);
      let outDir = paths.rules;
      if (args[2] === '--out' && args[3]) outDir = resolveUserPath(args[3]);
      else if (args[2] && !args[2].startsWith('-')) outDir = resolveUserPath(args[2]);
      const { manifest } = buildRulesPack(pcgenDir, outDir);
      const total = Object.values(manifest.counts).reduce((a, b) => a + b, 0);
      console.log(`Built rules pack in ${outDir}: ${total} records across ${manifest.books.length} books`);
      console.log(
        Object.entries(manifest.counts)
          .map(([k, v]) => `  ${k}: ${v}`)
          .join('\n'),
      );
      if (manifest.warnings.length) console.warn(`Warnings (${manifest.warnings.length}):\n  ${manifest.warnings.slice(0, 10).join('\n  ')}`);
    } else if (sub === 'install') {
      if (!args[1]) usage();
      const tarball = resolveUserPath(args[1]);
      const outDir = args[2] ? resolveUserPath(args[2]) : paths.rules;
      const { manifest } = installRulesPack(tarball, outDir);
      const total = Object.values(manifest.counts).reduce((a, b) => a + b, 0);
      console.log(`Installed rules pack in ${outDir}: ${total} records across ${manifest.books.length} books`);
    } else if (sub === 'rollback') {
      const outDir = args[1] ? resolveUserPath(args[1]) : paths.rules;
      const manifest = rollbackRulesPack(outDir);
      const total = Object.values(manifest.counts).reduce((a, b) => a + b, 0);
      console.log(`Rolled back rules pack in ${outDir}: ${total} records across ${manifest.books.length} books`);
    } else if (sub === 'status') {
      const outDir = args[1] ? resolveUserPath(args[1]) : paths.rules;
      if (!fs.existsSync(path.join(outDir, 'manifest.json'))) {
        console.log(`No rules pack installed in ${outDir}`);
      } else {
        const manifest = validateRulesDir(outDir);
        const total = Object.values(manifest.counts).reduce((a, b) => a + b, 0);
        console.log(`Rules pack in ${outDir}: ${total} records across ${manifest.books.length} books (built ${fmtDate(manifest.builtAt)})`);
      }
    } else {
      usage();
    }
  } catch (e) {
    console.error((e as Error).message);
    process.exitCode = 1;
  }
  process.exit(process.exitCode ?? 0);
}

const store = new SqliteRoomStore(paths.db);

try {
  switch (command) {
    case 'rooms': {
      const rooms = await store.listRooms();
      if (!rooms.length) console.log('No rooms yet.');
      for (const r of rooms) console.log(`${r.id.padEnd(24)} updated ${fmtDate(r.updatedAt)}  (${r.snapshots} snapshots)`);
      break;
    }
    case 'snapshots': {
      const roomId = roomArg(args[0]);
      for (const s of await store.listSnapshots(roomId)) {
        console.log(`#${String(s.id).padEnd(5)} ${fmtDate(s.createdAt).padEnd(24)} ${s.reason.padEnd(12)} ${s.label ?? ''}`);
      }
      break;
    }
    case 'backup': {
      const file = args[0] ? resolveUserPath(args[0]) : path.join(paths.backups, `vtt-${stamp()}.db`);
      store.backupTo(file);
      console.log(`Backed up database to ${file}`);
      break;
    }
    case 'export': {
      const roomId = roomArg(args[0]);
      const state = await store.load(roomId);
      if (!state) throw new Error(`No room "${roomId}"`);
      const file = args[1] ? resolveUserPath(args[1]) : resolveUserPath(`${roomId}-${stamp()}.json`);
      fs.writeFileSync(file, JSON.stringify(state, null, 2));
      console.log(`Exported "${roomId}" to ${file}`);
      break;
    }
    case 'import': {
      if (!args[0]) usage();
      const file = resolveUserPath(args[0]);
      const roomId = roomArg(args[1]);
      const state = migrateState(JSON.parse(fs.readFileSync(file, 'utf8')));
      const existing = await store.load(roomId);
      if (existing) {
        const snap = await store.createSnapshot(roomId, existing, 'pre-restore', `Before CLI import of ${path.basename(file)}`);
        console.log(`Saved the current "${roomId}" as snapshot #${snap.id}`);
      }
      await store.save(roomId, state);
      await store.createSnapshot(roomId, state, 'import', `CLI import of ${path.basename(file)}`);
      console.log(`Imported ${file} into "${roomId}". If the server was running, restart it now.`);
      break;
    }
    default:
      usage();
  }
} catch (e) {
  console.error((e as Error).message);
  process.exitCode = 1;
} finally {
  store.close();
}
