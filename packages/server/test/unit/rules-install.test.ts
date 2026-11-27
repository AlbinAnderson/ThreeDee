import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { installRulesPack, rollbackRulesPack, validateRulesDir } from '../../src/rules/installPack';

function makePackTarball(tmpDir: string, name: string, files: Record<string, string>): string {
  const srcDir = path.join(tmpDir, `src-${name}`);
  fs.mkdirSync(srcDir, { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(srcDir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  const tgz = path.join(tmpDir, `${name}.tgz`);
  execFileSync('tar', ['-czf', tgz, '-C', srcDir, '.']);
  return tgz;
}

function minimalPack(versionTag: string, bookName = 'Core Rulebook'): Record<string, string> {
  return {
    'manifest.json': JSON.stringify({
      format: 'vtt-rules-pack',
      version: 1,
      builtAt: Date.now(),
      from: versionTag,
      counts: {
        equipment: 1,
        equipmod: 0,
        spell: 0,
        feat: 0,
        ability: 0,
        deity: 0,
        domain: 0,
        class: 0,
        race: 0,
      },
      books: [{ key: bookName, name: bookName, short: 'CR', publisher: 'Paizo Inc.', bookType: 'Core', records: 1 }],
      warnings: [],
    }),
    'equipment.json': JSON.stringify([{ kind: 'equipment', key: `Item-${versionTag}`, name: `Item ${versionTag}` }]),
  };
}

describe('rules pack installer', () => {
  it('installs, atomically swaps with backup, and rolls back cleanly', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vtt-rules-install-'));
    try {
      const rulesDir = path.join(tmp, 'data', 'rules');
      const v1 = makePackTarball(tmp, 'v1', minimalPack('v1'));
      const v2 = makePackTarball(tmp, 'v2', minimalPack('v2'));

      const r1 = installRulesPack(v1, rulesDir);
      assert.equal(r1.manifest.from, 'v1');
      assert.equal(r1.previousDir, null);
      assert.equal(validateRulesDir(rulesDir).from, 'v1');

      const r2 = installRulesPack(v2, rulesDir);
      assert.equal(r2.manifest.from, 'v2');
      assert.ok(r2.previousDir && fs.existsSync(r2.previousDir));
      assert.equal(validateRulesDir(rulesDir).from, 'v2');

      const rolled = rollbackRulesPack(rulesDir);
      assert.equal(rolled.from, 'v1');
      assert.equal(validateRulesDir(rulesDir).from, 'v1');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('rejects invalid archives without disturbing an existing rules pack', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vtt-rules-invalid-'));
    try {
      const rulesDir = path.join(tmp, 'data', 'rules');
      const v1 = makePackTarball(tmp, 'v1', minimalPack('v1'));
      installRulesPack(v1, rulesDir);

      const missingCategory = makePackTarball(tmp, 'bad-missing', {
        'manifest.json': minimalPack('bad')['manifest.json']!,
      });
      assert.throws(() => installRulesPack(missingCategory, rulesDir), /missing equipment\.json/i);
      assert.equal(validateRulesDir(rulesDir).from, 'v1');

      const badFormat = makePackTarball(tmp, 'bad-format', {
        'manifest.json': JSON.stringify({ format: 'wrong', version: 1, counts: {}, books: [] }),
      });
      assert.throws(() => installRulesPack(badFormat, rulesDir), /invalid rules pack manifest format/i);
      assert.equal(validateRulesDir(rulesDir).from, 'v1');

      // Verify no leftover staging directories remain next to rulesDir.
      const siblings = fs.readdirSync(path.dirname(rulesDir));
      assert.deepEqual(siblings, ['rules']);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
