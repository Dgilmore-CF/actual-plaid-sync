import express from 'express';
import crypto from 'node:crypto';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { config } from './config.js';
import { db } from './db.js';
import { plaid, createLinkToken } from './plaid.js';
import { encrypt, decrypt } from './crypto.js';
import { listAccounts, createAccount, closeActual } from './actual.js';
import { syncAll, syncItem } from './sync.js';
const app = express();
app.disable('x-powered-by'); app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'", 'https://cdn.plaid.com'], frameSrc: ["'self'", 'https://cdn.plaid.com', 'https://*.plaid.com'], connectSrc: ["'self'", 'https://*.plaid.com'], styleSrc: ["'self'", "'unsafe-inline'"] } } }));
app.use(express.json({ limit: '128kb', verify: (req, _res, body) => { req.rawBody = body; } }));
app.use(rateLimit({ windowMs: 60000, limit: 120, standardHeaders: true, legacyHeaders: false }));
app.use(express.static('public'));
function safeEqual(a, b) { const x = Buffer.from(a || ''), y = Buffer.from(b || ''); return x.length === y.length && crypto.timingSafeEqual(x, y); }
function auth(req, res, next) { if (!safeEqual(req.get('x-admin-token'), config.adminToken)) return res.status(401).json({ error: 'Unauthorized' }); next(); }
app.get('/health', (_req, res) => res.json({ status: 'healthy' }));
app.get('/ready', async (_req, res) => { try { await listAccounts(); res.json({ status: 'ready' }); } catch { res.status(503).json({ status: 'not-ready' }); } });
app.get('/api/status', auth, async (_req, res, next) => { try { res.json({ plaidEnvironment: config.plaidEnv, actualAccounts: await listAccounts(), items: db.prepare('SELECT item_id,institution_name,last_sync_at,last_error FROM items').all(), mappings: db.prepare('SELECT * FROM mappings').all(), runs: db.prepare('SELECT * FROM sync_runs ORDER BY id DESC LIMIT 25').all() }); } catch (error) { next(error); } });
app.post('/api/link-token', auth, async (req, res, next) => { try { let token; if (req.body?.itemId) { const row = db.prepare('SELECT access_token_enc FROM items WHERE item_id=?').get(req.body.itemId); token = row ? decrypt(row.access_token_enc) : undefined; } res.json({ link_token: await createLinkToken(token) }); } catch (error) { next(error); } });
app.post('/api/exchange', auth, async (req, res, next) => { try { const body = z.object({ publicToken: z.string().min(10) }).parse(req.body); const exchanged = (await plaid.itemPublicTokenExchange({ public_token: body.publicToken })).data; const item = (await plaid.itemGet({ access_token: exchanged.access_token })).data.item; let name = 'Unknown institution'; if (item.institution_id) name = (await plaid.institutionsGetById({ institution_id: item.institution_id, country_codes: config.countries })).data.institution.name; db.prepare('INSERT OR REPLACE INTO items(item_id,institution_id,institution_name,access_token_enc) VALUES(?,?,?,?)').run(exchanged.item_id, item.institution_id, name, encrypt(exchanged.access_token)); const accounts = (await plaid.accountsGet({ access_token: exchanged.access_token })).data.accounts; const statement = db.prepare('INSERT OR REPLACE INTO mappings(plaid_account_id,item_id,plaid_name,plaid_type,plaid_subtype,enabled) VALUES(?,?,?,?,?,COALESCE((SELECT enabled FROM mappings WHERE plaid_account_id=?),0))'); db.exec('BEGIN'); try { for (const account of accounts) statement.run(account.account_id, exchanged.item_id, `${account.name}${account.mask ? ' •' + account.mask : ''}`, account.type, account.subtype, account.account_id); db.exec('COMMIT'); } catch (error) { db.exec('ROLLBACK'); throw error; } res.json({ itemId: exchanged.item_id, institution: name, accounts }); } catch (error) { next(error); } });
app.post('/api/accounts/create', auth, async (req, res, next) => { try { const body = z.object({ plaidAccountId: z.string(), name: z.string().min(1).max(100), offbudget: z.boolean().default(false) }).parse(req.body); const mapping = db.prepare('SELECT * FROM mappings WHERE plaid_account_id=?').get(body.plaidAccountId); if (!mapping) throw new Error('Unknown Plaid account'); const id = await createAccount({ name: body.name, offbudget: body.offbudget }); db.prepare('UPDATE mappings SET actual_account_id=?,actual_account_name=?,enabled=1 WHERE plaid_account_id=?').run(id, body.name, body.plaidAccountId); res.json({ id }); } catch (error) { next(error); } });
app.post('/api/mappings', auth, (req, res, next) => { try { const body = z.object({ plaidAccountId: z.string(), actualAccountId: z.string().nullable(), actualAccountName: z.string().nullable(), enabled: z.boolean() }).parse(req.body); db.prepare('UPDATE mappings SET actual_account_id=?,actual_account_name=?,enabled=? WHERE plaid_account_id=?').run(body.actualAccountId, body.actualAccountName, body.enabled ? 1 : 0, body.plaidAccountId); res.json({ ok: true }); } catch (error) { next(error); } });
app.post('/api/sync', auth, async (req, res, next) => { try { res.json(req.body?.itemId ? await syncItem(req.body.itemId) : await syncAll()); } catch (error) { next(error); } });
app.post('/webhooks/plaid', async (req, res) => { const key = crypto.createHash('sha256').update(req.rawBody || '').digest('hex'); if (!db.prepare('SELECT 1 FROM webhook_events WHERE event_key=?').get(key)) { db.prepare('INSERT INTO webhook_events(event_key) VALUES(?)').run(key); if (req.body?.item_id) syncItem(req.body.item_id).catch(console.error); } res.sendStatus(200); });
app.get('/oauth-return', (_req, res) => res.sendFile(new URL('../public/index.html', import.meta.url).pathname));
app.use((error, _req, res, _next) => res.status(error instanceof z.ZodError ? 400 : 500).json({ error: error instanceof z.ZodError ? 'Invalid request' : error?.response?.data?.error_message || error.message || 'Internal error' }));
const server = app.listen(config.port, () => console.log(`Actual Plaid Sync listening on ${config.port} (${config.plaidEnv})`));
setInterval(() => syncAll().catch(console.error), config.syncMinutes * 60000).unref();
async function stop() { server.close(); await closeActual(); process.exit(0); }
process.on('SIGTERM', stop); process.on('SIGINT', stop);
