import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = path => fs.readFileSync(new URL(path, import.meta.url), 'utf8');

test('dashboard provides a responsive app shell and semantic navigation', () => {
  const html = read('../public/index.html');
  const css = read('../public/styles.css');
  assert.match(html, /id="appShell" class="app-shell hidden"/);
  assert.match(html, /<nav aria-label="Main navigation">/);
  for (const view of ['home', 'connections', 'reviews', 'settings']) assert.match(html, new RegExp(`data-view="${view}"`));
  assert.match(html, /id="authForm"/);
  assert.match(css, /@media\(max-width:760px\)/);
  assert.match(css, /prefers-reduced-motion:reduce/);
});

test('connection status keeps reconnect conditional on Plaid reauthentication', () => {
  const app = read('../public/app.js');
  const html = read('../public/index.html');
  assert.match(app, /plaidStatus === 'reauth_required' \? `<button[^`]*data-reconnect=/);
  assert.match(app, /data-plaid-status=/);
  assert.match(html, /Check Plaid status first/);
  assert.match(app, /Plaid health is separate from transaction sync and reconciliation/);
});

test('dashboard styles cover connection, account, review, and status surfaces', () => {
  const css = read('../public/styles.css');
  for (const selector of ['.institution-card', '.account-summary-card', '.review-card', '.badge', '.empty-state']) {
    assert.ok(css.includes(selector), `missing dashboard style ${selector}`);
  }
});
