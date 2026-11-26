/**
 * Maintenance commands. Run from the repo root (-s hides npm's own output):
 *
 *   npm run -s vtt -- rooms                    list rooms
 *   npm run -s vtt -- snapshots <room>         list a room's snapshots
 *   npm run -s vtt -- backup [file]            consistent copy of the database (safe while running)
 *   npm run -s vtt -- export <room> [file]     room state as JSON
 *   npm run -s vtt -- import <file> <room>     load a JSON export into a room (stop the server first!)
 */
import fs from 'node:fs';
import path from 'node:path';
import { migrateState, RoomIdSchema } from '@vtt/shared';
import { paths } from './config';
import { SqliteRoomStore } from './persistence/SqliteRoomStore';

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
