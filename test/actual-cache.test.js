import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ensureActualDataDir } from '../src/paths.js';

test('creates the Actual API cache directory when it does not exist', () => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'actual-plaid-cache-test-'),
  );

  try {
    const expected = path.join(root, 'actual-cache');
    const result = ensureActualDataDir(root);

    assert.equal(result, expected);
    assert.equal(fs.existsSync(expected), true);
    assert.equal(fs.statSync(expected).isDirectory(), true);

    const secondResult = ensureActualDataDir(root);

    assert.equal(secondResult, expected);
    assert.equal(fs.statSync(expected).isDirectory(), true);
  } finally {
    fs.rmSync(root, {
      recursive: true,
      force: true,
    });
  }
});