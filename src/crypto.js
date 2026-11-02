import crypto from 'node:crypto';
import { config } from './config.js';
export function encrypt(text) { const iv = crypto.randomBytes(12); const cipher = crypto.createCipheriv('aes-256-gcm', config.key, iv); const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]); return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url'); }
export function decrypt(text) { const data = Buffer.from(text, 'base64url'); if (data.length < 29) throw new Error('Invalid encrypted value'); const decipher = crypto.createDecipheriv('aes-256-gcm', config.key, data.subarray(0, 12)); decipher.setAuthTag(data.subarray(12, 28)); return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString('utf8'); }
