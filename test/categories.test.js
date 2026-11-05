import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
test('category integration uses Plaid personal finance categories',()=>{const s=fs.readFileSync(new URL('../src/categories.js',import.meta.url),'utf8');assert.match(s,/personal_finance_category/);assert.match(s,/Plaid Auto Categories/);assert.match(s,/backfillCategories/)});
test('category backfill endpoint exists',()=>{const s=fs.readFileSync(new URL('../src/server.js',import.meta.url),'utf8');assert.match(s,/\/api\/categories\/backfill/)});
