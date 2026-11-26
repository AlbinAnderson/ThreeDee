import http from 'node:http';
import path from 'node:path';
import express from 'express';
import { config, paths } from './config';
import { assetRouter } from './net/assets';
import { attachWebSocket } from './net/socket';
import { importLegacyRooms } from './persistence/importLegacy';
import { SqliteRoomStore } from './persistence/SqliteRoomStore';
import { RoomManager } from './rooms/RoomManager';

const store = new SqliteRoomStore(paths.db);
await importLegacyRooms(store, paths.legacyRooms);
const rooms = new RoomManager(store);

const app = express();
app.disable('x-powered-by');
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});
app.use(assetRouter(paths.assets, config.maxUploadBytes));

if (config.serveClient) {
  app.use(express.static(config.clientDist));
  // SPA fallback
  app.use((req, res, next) => {
    if (req.method !== 'GET') return next();
    res.sendFile(path.join(config.clientDist, 'index.html'));
  });
}

app.use((err: Error & { status?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const status = err.status ?? 500;
  if (status >= 500) console.error('[http]', err);
  res.status(status).json({ error: status >= 500 ? 'Server error' : err.message });
});

const server = http.createServer(app);
attachWebSocket(server, rooms);

server.listen(config.port, config.host, () => {
  console.log(`[server] listening on http://${config.host}:${config.port}`);
  console.log(`[server] database: ${paths.db}`);
  if (!config.gmPassword) console.log('[server] GM_PASSWORD not set: anyone can join as GM');
});

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[server] ${signal} received, saving rooms...`);
  await rooms.flushAll();
  store.close();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
