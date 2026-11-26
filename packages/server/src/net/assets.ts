import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import express from 'express';

/** Accepted upload types. SVG is intentionally excluded (it can carry scripts). */
const EXTENSIONS: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/avif': '.avif',
};

/**
 * POST /api/assets  (raw image body, Content-Type: image/*)  -> { url }
 * GET  /assets/<hash>.<ext>
 *
 * Files are content-addressed, so identical uploads are stored once and can
 * be cached forever.
 */
export function assetRouter(dir: string, maxBytes: number) {
  const router = express.Router();

  router.post(
    '/api/assets',
    express.raw({ type: Object.keys(EXTENSIONS), limit: maxBytes }),
    async (req, res, next) => {
      try {
        const mime = req.headers['content-type']?.split(';')[0]?.trim() ?? '';
        const ext = EXTENSIONS[mime];
        if (!ext || !Buffer.isBuffer(req.body) || req.body.length === 0) {
          res.status(400).json({ error: `Unsupported upload. Allowed: ${Object.keys(EXTENSIONS).join(', ')}` });
          return;
        }
        const name = createHash('sha256').update(req.body).digest('hex').slice(0, 32) + ext;
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(path.join(dir, name), req.body, { flag: 'wx' }).catch((e: NodeJS.ErrnoException) => {
          if (e.code !== 'EEXIST') throw e;
        });
        res.json({ url: `/assets/${name}` });
      } catch (e) {
        next(e);
      }
    },
  );

  router.use('/assets', express.static(dir, { immutable: true, maxAge: '365d', fallthrough: false }));

  return router;
}
