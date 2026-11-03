import fs from 'node:fs';
import path from 'node:path';

export function ensureActualDataDir(baseDataDir) {
  const actualDataDir = path.join(baseDataDir, 'actual-cache');

  fs.mkdirSync(actualDataDir, {
    recursive: true,
    mode: 0o700,
  });

  return actualDataDir;
}