import express from 'express';
import { readFileSync } from 'node:fs';
import crypto from 'node:crypto';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { config } from './config.js';
import { db } from './db.js';
import { plaid, createLinkToken } from './plaid.js';
import { encrypt, decrypt } from './crypto.js';
import {
  listAccounts, createAccount, updateAccount, deleteAccount,
  backupBudget, syncActual, shutdown,
} from './actual.js';
import { syncAll, syncItem, previewInitial, approveInitial, eligibleItemIds, waitForSyncs } from './sync.js';
import { verifyPlaidWebhook } from './webhook.js';
import { duplicateAccounts } from './item-identity.js';
import { cancelItemReconnect, confirmItemReconnect, failItemReconnect } from './item-reconnect.js';
import { createItemReconnectStore } from './item-reconnect-store.js';
import { issueOAuthState, consumeOAuthState } from './oauth-state.js';
import {
  archiveLegacyReviews, classifyReview, listReviews, reviewDetails,
  productionOpenReviewCount, resolveReview,
} from './reviews.js';
import { historyStatus, recoverMissingHistory } from './history-recovery.js';
import { backfillCategories } from './categories.js';
import { investigateAccount, refreshItemBalances } from './reconciliation.js';
import { previewStartingBalance, recalculateStartingBalance } from './starting-balance.js';
import { syncCoordinator } from './sync-coordinator.js';
import { resolveAndRefreshReview } from './review-resolution.js';

const appVersion = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
const app = express();
const reconnectStore = createItemReconnectStore(db);
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", 'https://cdn.plaid.com'],
      frameSrc: ["'self'", 'https://cdn.plaid.com', 'https://*.plaid.com'],
      connectSrc: ["'self'", 'https://*.plaid.com'],
      styleSrc: ["'self'", "'unsafe-inline'"],
    },
  },
}));
app.use(express.json({ limit: '128kb', verify: (request, _response, body) => { request.rawBody = body; } }));
app.use(rateLimit({ windowMs: 60000, limit: 120, standardHeaders: true, legacyHeaders: false }));
app.use(express.static('public'));

const equal = (left, right) => {
  const a = Buffer.from(left || '');
  const b = Buffer.from(right || '');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};
const auth = (request, response, next) => equal(request.get('x-admin-token'), config.adminToken)
  ? next() : response.status(401).json({ error: 'Unauthorized' });

function readCookie(request, name) {
  for (const part of (request.headers.cookie || '').split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return decodeURIComponent(value.join('='));
  }
  return null;
}

function itemStatus(item) {
  const included = eligibleItemIds().includes(item.item_id);
  return {
    ...item,
    last_error: item.last_error ? (/^Reconciliation exception on \d+ account\(s\)$/.test(item.last_error) ? item.last_error : 'Item sync reported an error') : null,
    automatic_sync: included,
    sync_status: included ? syncCoordinator.status(item.item_id) : 'excluded',
    sync_status_label: included ? syncCoordinator.status(item.item_id) : 'Excluded from automatic synchronization',
  };
}

app.get('/health', (_request, response) => response.json({ status: 'healthy', version: appVersion }));
app.get('/ready', async (_request, response) => {
  try {
    await listAccounts();
    response.json({ status: 'ready' });
  } catch {
    response.status(503).json({ status: 'not-ready', error: 'Actual API is unavailable' });
  }
});

app.get('/api/status', auth, async (_request, response, next) => {
  try {
    response.json({
      version: appVersion,
      plaidEnvironment: config.plaidEnv,
      actualAccounts: await listAccounts(),
      items: db.prepare('SELECT item_id,institution_name,last_sync_at,last_error FROM items').all().map(itemStatus),
      mappings: db.prepare('SELECT * FROM mappings').all(),
      reviews: listReviews('production-open'),
      reviewCounts: { productionOpen: productionOpenReviewCount() },
      runs: db.prepare(`SELECT id,item_id,started_at,finished_at,added,modified,removed,reconciliation_mismatches,
        CASE WHEN error IS NULL THEN NULL ELSE 'Sync run reported an error' END AS error,last_progress_at,phase
        FROM sync_runs ORDER BY id DESC LIMIT 25`).all(),
      activeSyncItemSuffixes: syncCoordinator.activeItemIds().map(itemId => String(itemId).slice(-6)),
    });
  } catch (error) { next(error); }
});

app.get('/api/reviews', auth, (request, response, next) => {
  try { response.json({ reviews: listReviews(request.query.filter || 'production-open') }); }
  catch (error) { next(error); }
});

app.post('/api/link-token', auth, async (request, response, next) => {
  let reconnectId;
  let itemId;
  try {
    const body = z.object({ itemId: z.string().min(1).optional() }).parse(request.body || {});
    let accessToken;
    if (body.itemId) {
      itemId = body.itemId;
      const item = db.prepare('SELECT access_token_enc FROM items WHERE item_id=?').get(itemId);
      if (!item) return response.status(404).json({ error: 'Unknown Plaid Item' });
      accessToken = decrypt(item.access_token_enc);
      reconnectId = crypto.randomUUID();
      reconnectStore.start(reconnectId, itemId);
    }
    const state = issueOAuthState();
    response.setHeader('Set-Cookie', `plaid_oauth_state=${encodeURIComponent(state)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`);
    const linkToken = await createLinkToken(accessToken);
    response.json(reconnectId ? { link_token: linkToken, reconnectId } : { link_token: linkToken });
  } catch (error) {
    if (reconnectId) reconnectStore.fail(reconnectId, itemId, 'link_token_creation_failed');
    next(error);
  }
});

app.post('/api/exchange', auth, async (request, response, next) => {
  try {
    const body = z.object({ publicToken: z.string().min(10) }).parse(request.body);
    const exchange = (await plaid.itemPublicTokenExchange({ public_token: body.publicToken })).data;
    const item = (await plaid.itemGet({ access_token: exchange.access_token })).data.item;
    const accounts = (await plaid.accountsGet({ access_token: exchange.access_token })).data.accounts;
    const duplicates = duplicateAccounts(item.institution_id, accounts);
    if (duplicates.length) {
      try { await plaid.itemRemove({ access_token: exchange.access_token }); } catch {}
      return response.status(409).json({ error: 'Duplicate Plaid connection blocked', duplicates });
    }
    let institutionName = 'Unknown institution';
    if (item.institution_id) {
      institutionName = (await plaid.institutionsGetById({
        institution_id: item.institution_id,
        country_codes: config.countries,
      })).data.institution.name;
    }
    db.prepare('INSERT INTO items(item_id,institution_id,institution_name,access_token_enc) VALUES(?,?,?,?)')
      .run(exchange.item_id, item.institution_id, institutionName, encrypt(exchange.access_token));
    const insert = db.prepare(`INSERT INTO mappings(
      plaid_account_id,item_id,persistent_account_id,plaid_name,plaid_mask,plaid_type,plaid_subtype,current_balance,available_balance
    ) VALUES(?,?,?,?,?,?,?,?,?)`);
    db.exec('BEGIN');
    try {
      for (const account of accounts) {
        insert.run(account.account_id, exchange.item_id, account.persistent_account_id || null,
          account.name, account.mask, account.type, account.subtype,
          account.balances.current, account.balances.available);
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    response.json({ itemId: exchange.item_id, institution: institutionName, accounts });
  } catch (error) { next(error); }
});

app.post('/api/reconnect', auth, async (request, response, next) => {
  let itemId;
  let reconnectId;
  try {
    const body = z.object({ itemId: z.string().min(1), reconnectId: z.string().uuid() }).parse(request.body);
    itemId = body.itemId;
    reconnectId = body.reconnectId;
    const result = await confirmItemReconnect({
      itemId,
      reconnectId,
      loadAttempt: reconnectStore.load,
      loadItem: itemId => db.prepare('SELECT item_id,access_token_enc FROM items WHERE item_id=?').get(itemId),
      verifyItem: async existing => (await plaid.itemGet({ access_token: decrypt(existing.access_token_enc) })).data.item,
      finalizeReconnect: reconnectStore.finalize,
    });
    response.json(result);
  } catch (error) {
    if (reconnectId && itemId) {
      const failureCode = error.message === 'Plaid Item still requires attention' ? 'item_still_requires_attention'
        : error.message === 'Unknown Plaid Item' ? 'item_not_found'
          : error.message === 'Reconnect attempt changed during verification' ? 'update_conflict'
            : 'verification_failed';
      reconnectStore.fail(reconnectId, itemId, failureCode);
    }
    if (error.message === 'Unknown reconnect attempt') return response.status(404).json({ error: error.message });
    if (error.message === 'Unknown Plaid Item') return response.status(404).json({ error: error.message });
    if (error.message === 'Plaid Item still requires attention' || error.message === 'Reconnect attempt is not active' || error.message === 'Reconnect attempt changed during verification') {
      return response.status(409).json({ error: 'Plaid has not confirmed a healthy connection for that Item' });
    }
    next(error);
  }
});

app.post('/api/reconnect/cancel', auth, async (request, response, next) => {
  try {
    const body = z.object({ itemId: z.string().min(1), reconnectId: z.string().uuid() }).parse(request.body);
    const result = await cancelItemReconnect({
      itemId: body.itemId,
      reconnectId: body.reconnectId,
      loadAttempt: reconnectStore.load,
      cancelAttempt: reconnectStore.cancel,
    });
    response.json(result);
  } catch (error) {
    if (error.message === 'Unknown reconnect attempt') return response.status(404).json({ error: error.message });
    if (error.message === 'Reconnect attempt is not active' || error.message === 'Reconnect attempt changed before cancellation') {
      return response.status(409).json({ error: 'Reconnect attempt has already finished' });
    }
    next(error);
  }
});

app.post('/api/reconnect/fail', auth, async (request, response, next) => {
  try {
    const body = z.object({
      itemId: z.string().min(1),
      reconnectId: z.string().uuid(),
      failureCode: z.enum(['link_exit_error', 'link_initialization_failed']),
    }).parse(request.body);
    const result = await failItemReconnect({
      itemId: body.itemId,
      reconnectId: body.reconnectId,
      failureCode: body.failureCode,
      loadAttempt: reconnectStore.load,
      failAttempt: (itemId, reconnectId, code) => reconnectStore.fail(reconnectId, itemId, code),
    });
    response.json(result);
  } catch (error) {
    if (error.message === 'Unknown reconnect attempt') return response.status(404).json({ error: error.message });
    if (error.message === 'Reconnect attempt is not active' || error.message === 'Reconnect attempt changed before failure was recorded') {
      return response.status(409).json({ error: 'Reconnect attempt has already finished' });
    }
    next(error);
  }
});

app.post('/api/accounts/create', auth, async (request, response, next) => {
  try {
    const body = z.object({ plaidAccountId: z.string(), name: z.string().min(1).max(100), offbudget: z.boolean().default(false) }).parse(request.body);
    const id = await createAccount({ name: body.name, offbudget: body.offbudget });
    db.prepare('UPDATE mappings SET actual_account_id=?,actual_account_name=?,offbudget=?,enabled=1 WHERE plaid_account_id=?')
      .run(id, body.name, body.offbudget ? 1 : 0, body.plaidAccountId);
    response.json({ ok: true });
  } catch (error) { next(error); }
});

app.post('/api/accounts/:id/rename', auth, async (request, response, next) => {
  try {
    const body = z.object({ name: z.string().trim().min(1).max(100) }).parse(request.body);
    await updateAccount(request.params.id, { name: body.name });
    await syncActual();
    db.prepare('UPDATE mappings SET actual_account_name=? WHERE actual_account_id=?').run(body.name, request.params.id);
    response.json({ ok: true, name: body.name });
  } catch (error) { next(error); }
});

app.post('/api/categories/backfill', auth, async (_request, response, next) => {
  try { response.json(await backfillCategories()); } catch (error) { next(error); }
});

app.post('/api/history/status', auth, async (request, response, next) => {
  try {
    const body = z.object({ plaidAccountId: z.string() }).parse(request.body);
    response.json(await historyStatus(body.plaidAccountId));
  } catch (error) { next(error); }
});

app.post('/api/history/recover', auth, async (request, response, next) => {
  try {
    const body = z.object({ plaidAccountId: z.string(), confirmation: z.literal('RECOVER MISSING HISTORY') }).parse(request.body);
    response.json(await recoverMissingHistory(body.plaidAccountId));
  } catch (error) { next(error); }
});

app.post('/api/mappings', auth, (request, response, next) => {
  try {
    const body = z.object({ plaidAccountId: z.string(), actualAccountId: z.string().nullable(), actualAccountName: z.string().nullable(), offbudget: z.boolean().default(false), enabled: z.boolean() }).parse(request.body);
    db.prepare('UPDATE mappings SET actual_account_id=?,actual_account_name=?,offbudget=?,enabled=? WHERE plaid_account_id=?')
      .run(body.actualAccountId, body.actualAccountName, body.offbudget ? 1 : 0, body.enabled ? 1 : 0, body.plaidAccountId);
    response.json({ ok: true });
  } catch (error) { next(error); }
});

app.post('/api/refresh', auth, async (request, response, next) => {
  try {
    const { itemId } = z.object({ itemId: z.string() }).parse(request.body);
    const item = db.prepare('SELECT access_token_enc FROM items WHERE item_id=?').get(itemId);
    if (!item) throw new Error('Unknown Plaid Item');
    const result = await plaid.transactionsRefresh({ access_token: decrypt(item.access_token_enc) });
    response.json({ requestId: result.data.request_id || null });
  } catch (error) { next(error); }
});

app.post('/api/initial/preview', auth, async (request, response, next) => {
  try { response.json(await previewInitial(z.object({ plaidAccountId: z.string() }).parse(request.body).plaidAccountId)); }
  catch (error) { next(error); }
});
app.post('/api/initial/approve', auth, async (request, response, next) => {
  try { response.json(await approveInitial(z.object({ plaidAccountId: z.string() }).parse(request.body).plaidAccountId)); }
  catch (error) { next(error); }
});

app.post('/api/sync', auth, async (request, response, next) => {
  try {
    if (request.body?.itemId) {
      const { itemId } = z.object({ itemId: z.string() }).parse(request.body);
      response.json(await syncItem(itemId, { source: 'manual' }));
    } else {
      response.json(await syncAll({ source: 'manual' }));
    }
  } catch (error) { next(error); }
});

app.get('/api/investigation/:plaidAccountId', auth, async (request, response, next) => {
  try { response.json(await investigateAccount(request.params.plaidAccountId)); }
  catch (error) { next(error); }
});

app.post('/api/starting-balance/preview', auth, async (request, response, next) => {
  try {
    const body = z.object({ plaidAccountId: z.string() }).parse(request.body);
    response.json(await previewStartingBalance(body.plaidAccountId));
  } catch (error) { next(error); }
});

app.post('/api/starting-balance/recalculate', auth, async (request, response, next) => {
  try {
    const body = z.object({
      plaidAccountId: z.string(),
      confirmation: z.literal('RECALCULATE STARTING BALANCE'),
      expected: z.object({ adjustmentCents: z.number().int(), proposedStartingBalanceCents: z.number().int(), backupPath: z.string() }),
    }).parse(request.body);
    const result = await recalculateStartingBalance(body.plaidAccountId, body.confirmation, body.expected);
    try {
      const item = db.prepare('SELECT item_id FROM mappings WHERE plaid_account_id=?').get(body.plaidAccountId);
      if (item) result.reconciliation = await refreshItemBalances(item.item_id);
    } catch { result.reconciliationUnavailable = true; }
    response.json(result);
  } catch (error) { next(error); }
});

app.post('/api/maintenance/remove-sandbox-accounts', auth, async (request, response, next) => {
  try {
    z.object({ confirmation: z.literal('REMOVE SANDBOX ACCOUNTS') }).parse(request.body);
    const names = ['Plaid Sandbox Checking', 'Plaid Dynamic Checking'];
    const accounts = await listAccounts();
    const matches = accounts.filter(account => names.includes(account.name));
    if (!matches.length) return response.json({ removed: [], message: 'No sandbox test accounts were found.' });
    const backup = await backupBudget();
    const removed = [];
    for (const account of matches) {
      await deleteAccount(account.id);
      db.prepare('UPDATE mappings SET actual_account_id=NULL,actual_account_name=NULL,enabled=0 WHERE actual_account_id=?').run(account.id);
      removed.push(account.name);
    }
    await syncActual();
    response.json({ backup, removed, message: 'Sandbox test accounts removed from Actual.' });
  } catch (error) { next(error); }
});

app.get('/api/reviews/:id', auth, async (request, response, next) => {
  try {
    const review = await reviewDetails(Number(request.params.id));
    if (!review) return response.status(404).json({ error: 'Review not found' });
    response.json(review);
  } catch (error) { next(error); }
});

app.post('/api/reviews/:id/resolve', auth, async (request, response, next) => {
  try {
    const body = z.object({
      action: z.enum(['keep', 'delete', 'resolve', 'replace_pending', 'keep_both', 'delete_stale_pending', 'no_match']),
      candidateActualIdSuffix: z.string().optional(),
      confirmation: z.string().optional(),
      confirmedDetails: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
      confirmedPostedDetails: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
    }).parse(request.body);
    const review = db.prepare('SELECT item_id FROM review_queue WHERE id=?').get(Number(request.params.id));
    const result = await resolveAndRefreshReview({
      withNoSync: task => syncCoordinator.withNoSync(task),
      resolve: resolveReview,
      refresh: refreshItemBalances,
      itemId: review?.item_id,
      id: Number(request.params.id),
      action: body.action,
      options: body,
    });
    response.json(result);
  } catch (error) { next(error); }
});

app.post('/api/reviews/:id/classify', auth, (request, response, next) => {
  try {
    const body = z.object({ environment: z.enum(['production', 'sandbox', 'legacy_unknown']), sourceItemStatus: z.enum(['active', 'excluded', 'removed', 'unknown']) }).parse(request.body);
    response.json(classifyReview(Number(request.params.id), body));
  } catch (error) { next(error); }
});

app.post('/api/reviews/archive-legacy', auth, (request, response, next) => {
  try {
    const body = z.object({ confirmation: z.literal('ARCHIVE LEGACY REVIEWS') }).parse(request.body);
    response.json(archiveLegacyReviews(body.confirmation));
  } catch (error) { next(error); }
});

app.post('/webhooks/plaid', async (request, response) => {
  try {
    await verifyPlaidWebhook(request.get('Plaid-Verification'), request.rawBody);
    const eventKey = crypto.createHash('sha256').update(request.rawBody).digest('hex');
    if (db.prepare('SELECT 1 FROM webhook_events WHERE event_key=?').get(eventKey)) return response.sendStatus(200);
    db.prepare('INSERT INTO webhook_events(event_key) VALUES(?)').run(eventKey);
    response.sendStatus(200);
    if (request.body?.item_id) {
      syncItem(request.body.item_id, { source: 'webhook' }).catch(() => {});
    }
  } catch {
    response.sendStatus(401);
  }
});

app.get('/oauth-return', (request, response) => {
  const state = readCookie(request, 'plaid_oauth_state');
  if (!consumeOAuthState(state)) return response.status(400).send('Invalid, expired, or reused OAuth state. Return to the application and restart Link.');
  response.setHeader('Set-Cookie', 'plaid_oauth_state=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0');
  response.sendFile(new URL('../public/index.html', import.meta.url).pathname);
});

app.use((error, _request, response, _next) => {
  const isValidationError = error instanceof z.ZodError;
  const message = String(error?.message || 'Internal error');
  const sensitiveContent = error?.response || /token|secret|password|account[_ -]?id|[A-Za-z0-9_-]{40,}/i.test(message);
  response.status(isValidationError ? 400 : 500).json({
    error: isValidationError ? 'Invalid request' : sensitiveContent ? 'External service or protected data operation failed' : message,
  });
});

const server = app.listen(config.port, () => console.log(`Actual Plaid Sync ${appVersion} listening on ${config.port} (${config.plaidEnv})`));
const scheduler = setInterval(() => syncAll({ source: 'scheduled' }).catch(() => {}), config.syncMinutes * 60000);
scheduler.unref();

let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  clearInterval(scheduler);
  await new Promise(resolve => server.close(resolve));
  await waitForSyncs();
  await shutdown();
  process.exit(0);
}
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
