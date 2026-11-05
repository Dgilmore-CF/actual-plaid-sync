import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
test('operation feedback is loaded before the application module',()=>{const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');assert.ok(html.indexOf('/feedback.js')>0);assert.ok(html.indexOf('/feedback.js')<html.indexOf('/app.js'))});
test('feedback module provides loading success and failure states',()=>{const js=fs.readFileSync(new URL('../public/feedback.js',import.meta.url),'utf8');assert.match(js,/is-loading/);assert.match(js,/Operation completed successfully/);assert.match(js,/operation failed/)});
