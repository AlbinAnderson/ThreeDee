import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, '../../..');

export const config = {
  port: Number(process.env.PORT ?? 3001),
  host: process.env.HOST ?? '0.0.0.0',
  /** Rooms and uploaded assets live here. Back this directory up. */
  dataDir: path.resolve(process.env.DATA_DIR ?? path.join(REPO_ROOT, 'data')),
  /** If set, joining as GM requires this password. If unset, anyone may join as GM. */
  gmPassword: process.env.GM_PASSWORD || null,
  /** In production the server also serves the built client. */
  serveClient: process.env.NODE_ENV === 'production',
  clientDist: path.join(REPO_ROOT, 'packages/client/dist'),
  maxUploadBytes: Number(process.env.MAX_UPLOAD_MB ?? 30) * 1024 * 1024,
  saveDebounceMs: 1000,
};
