import crypto from 'node:crypto';
import { db } from './db.js';
const TTL_MS = 10 * 60 * 1000;
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
export function issueOAuthState(){
  const value=crypto.randomBytes(32).toString('base64url');
  const expires=new Date(Date.now()+TTL_MS).toISOString();
  db.prepare('INSERT INTO oauth_states(state_hash,expires_at) VALUES(?,?)').run(hash(value),expires);
  db.prepare("DELETE FROM oauth_states WHERE expires_at < datetime('now','-1 day')").run();
  return value;
}
export function consumeOAuthState(value){
  if(!value)return false;
  const row=db.prepare('SELECT expires_at,used_at FROM oauth_states WHERE state_hash=?').get(hash(value));
  if(!row||row.used_at||Date.parse(row.expires_at)<Date.now())return false;
  db.prepare('UPDATE oauth_states SET used_at=CURRENT_TIMESTAMP WHERE state_hash=?').run(hash(value));
  return true;
}
