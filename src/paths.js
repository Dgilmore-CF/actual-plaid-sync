import fs from 'node:fs';
import path from 'node:path';
export function ensureDir(dir){fs.mkdirSync(dir,{recursive:true,mode:0o700});return dir;}
export function ensureActualDataDir(base){return ensureDir(path.join(base,'actual-cache'));}
export function ensureBackupDir(base){return ensureDir(path.join(base,'backups'));}
