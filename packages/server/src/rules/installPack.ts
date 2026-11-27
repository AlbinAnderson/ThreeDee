/**
 * Atomic rules-pack installer and rollback helpers used by `cli.ts` and
 * `scripts/install-rules-remote.sh` (so production deploys can update
 * `DATA_DIR/rules/` safely as the `tabletop` service user).
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { RULES_KINDS, type RulesManifest } from '@vtt/shared';

function assertSafeTarEntries(tarballPath: string): void {
  const listing = execFileSync('tar', ['-tzf', tarballPath], { encoding: 'utf8' });
  const entries = listing
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (entries.length === 0) {
    throw new Error('Rules pack archive is empty');
  }
  for (const entry of entries) {
    const normalized = entry.replace(/\\/g, '/');
    if (normalized.startsWith('/') || normalized.split('/').includes('..')) {
      throw new Error(`Unsafe path in rules pack archive: ${entry}`);
    }
  }
}

export function validateRulesDir(dir: string): RulesManifest {
  const manifestPath = path.join(dir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error('Rules pack is missing manifest.json');
  }
  const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as Partial<RulesManifest>;
  if (raw.format !== 'vtt-rules-pack' || typeof raw.version !== 'number') {
    throw new Error(`Invalid rules pack manifest format: ${String(raw.format)}`);
  }
  if (!raw.counts || typeof raw.counts !== 'object' || !Array.isArray(raw.books)) {
    throw new Error('Rules pack manifest is missing counts or books');
  }
  let total = 0;
  for (const kind of RULES_KINDS) {
    const count = raw.counts[kind] ?? 0;
    if (typeof count !== 'number' || count < 0) {
      throw new Error(`Invalid manifest count for ${kind}`);
    }
    total += count;
    if (count > 0) {
      const filePath = path.join(dir, `${kind}.json`);
      if (!fs.existsSync(filePath)) {
        throw new Error(`Rules pack is missing ${kind}.json (manifest declares ${count} records)`);
      }
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (!Array.isArray(parsed)) {
        throw new Error(`Rules pack ${kind}.json is not a JSON array`);
      }
    }
  }
  if (total === 0) {
    throw new Error('Rules pack contains 0 records');
  }
  return raw as RulesManifest;
}

export function installRulesPack(tarballPath: string, outDir: string): { manifest: RulesManifest; previousDir: string | null } {
  const resolvedTarball = path.resolve(tarballPath);
  const resolvedOut = path.resolve(outDir);
  if (!fs.existsSync(resolvedTarball) || !fs.statSync(resolvedTarball).isFile()) {
    throw new Error(`Rules pack archive not found: ${resolvedTarball}`);
  }

  assertSafeTarEntries(resolvedTarball);

  const parent = path.dirname(resolvedOut);
  const base = path.basename(resolvedOut);
  fs.mkdirSync(parent, { recursive: true });

  const stageDir = path.join(parent, `${base}.new-${process.pid}-${Date.now()}`);
  const prevDir = path.join(parent, `${base}.prev`);
  let swapped = false;

  try {
    fs.mkdirSync(stageDir, { recursive: true });
    execFileSync('tar', ['-xzf', resolvedTarball, '-C', stageDir, '--no-same-owner']);
    const manifest = validateRulesDir(stageDir);

    const hadExisting = fs.existsSync(resolvedOut);
    if (hadExisting) {
      fs.rmSync(prevDir, { recursive: true, force: true });
      fs.renameSync(resolvedOut, prevDir);
    }
    try {
      fs.renameSync(stageDir, resolvedOut);
      swapped = true;
    } catch (err) {
      if (hadExisting && fs.existsSync(prevDir) && !fs.existsSync(resolvedOut)) {
        fs.renameSync(prevDir, resolvedOut);
      }
      throw err;
    }

    return { manifest, previousDir: hadExisting ? prevDir : null };
  } finally {
    if (!swapped) {
      fs.rmSync(stageDir, { recursive: true, force: true });
    }
  }
}

export function rollbackRulesPack(outDir: string): RulesManifest {
  const resolvedOut = path.resolve(outDir);
  const parent = path.dirname(resolvedOut);
  const base = path.basename(resolvedOut);
  const prevDir = path.join(parent, `${base}.prev`);
  const failedDir = path.join(parent, `${base}.failed-${process.pid}-${Date.now()}`);

  if (!fs.existsSync(prevDir)) {
    throw new Error(`No previous rules pack backup found at ${prevDir}`);
  }
  const manifest = validateRulesDir(prevDir);

  const hadCurrent = fs.existsSync(resolvedOut);
  if (hadCurrent) {
    fs.renameSync(resolvedOut, failedDir);
  }
  try {
    fs.renameSync(prevDir, resolvedOut);
  } catch (err) {
    if (hadCurrent && fs.existsSync(failedDir) && !fs.existsSync(resolvedOut)) {
      fs.renameSync(failedDir, resolvedOut);
    }
    throw err;
  }
  fs.rmSync(failedDir, { recursive: true, force: true });
  return manifest;
}
