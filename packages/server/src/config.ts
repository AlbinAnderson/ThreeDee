import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_SNAPSHOT_POLICY } from './persistence/snapshotPolicy';

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, '../../..');

export const config = {
  port: Number(process.env.PORT ?? 3001),
  host: process.env.HOST ?? '0.0.0.0',
  /** Database (vtt.db) and uploaded assets live here. Back this directory up. */
  dataDir: path.resolve(process.env.DATA_DIR ?? path.join(REPO_ROOT, 'data')),
  /** If set, joining as GM requires this password. If unset, anyone may join as GM. */
  gmPassword: process.env.GM_PASSWORD || null,
  /** In production the server also serves the built client. */
  serveClient: process.env.NODE_ENV === 'production',
  clientDist: path.join(REPO_ROOT, 'packages/client/dist'),
  maxUploadBytes: Number(process.env.MAX_UPLOAD_MB ?? 60) * 1024 * 1024,
  saveDebounceMs: 1000,
  snapshotPolicy: {
    ...DEFAULT_SNAPSHOT_POLICY,
    autoIntervalMs: Number(process.env.SNAPSHOT_INTERVAL_MIN ?? 60) * 60 * 1000,
  },
};

export const paths = {
  db: path.join(config.dataDir, 'vtt.db'),
  assets: path.join(config.dataDir, 'assets'),
  backups: path.join(config.dataDir, 'backups'),
  /** Where the pre-SQLite JSON store kept rooms (imported on startup). */
  legacyRooms: path.join(config.dataDir, 'rooms'),
};
