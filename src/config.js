import crypto from 'node:crypto';
function required(name) { const value = process.env[name]?.trim(); if (!value) throw new Error(`Missing required environment variable: ${name}`); return value; }
const key = required('TOKEN_ENCRYPTION_KEY');
if (!/^[a-f0-9]{64}$/i.test(key)) throw new Error('TOKEN_ENCRYPTION_KEY must be 64 hexadecimal characters');
export const config = Object.freeze({
  port: Number(process.env.PORT || 3000),
  appUrl: required('APP_URL').replace(/\/$/, ''),
  adminToken: required('ADMIN_TOKEN'),
  sessionSecret: required('SESSION_SECRET'),
  key: Buffer.from(key, 'hex'),
  plaidEnv: process.env.PLAID_ENV === 'production' ? 'production' : 'sandbox',
  plaidClientId: required('PLAID_CLIENT_ID'),
  plaidSecret: required('PLAID_SECRET'),
  countries: (process.env.PLAID_COUNTRY_CODES || 'US').split(',').map(x => x.trim()),
  actualUrl: required('ACTUAL_SERVER_URL'),
  actualPassword: required('ACTUAL_SERVER_PASSWORD'),
  budgetId: required('ACTUAL_BUDGET_ID'),
  budgetPassword: process.env.ACTUAL_BUDGET_PASSWORD || undefined,
  dataDir: process.env.DATA_DIR || '/data',
  syncMinutes: Math.max(15, Number(process.env.SYNC_INTERVAL_MINUTES || 240)),
  importDays: Math.min(730, Math.max(1, Number(process.env.IMPORT_DAYS || 90))),
  userId: crypto.createHash('sha256').update(required('ADMIN_TOKEN')).digest('hex').slice(0, 32),
});
