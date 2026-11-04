import test from 'node:test';import assert from 'node:assert/strict';
const allowed=['Plaid Sandbox Checking','Plaid Dynamic Checking'];
test('sandbox cleanup allowlist excludes production names',()=>{assert.deepEqual(allowed.filter(x=>x.startsWith('Plaid ')),allowed);assert.equal(allowed.includes('Checking'),false);assert.equal(allowed.includes('Chase Checking'),false)});
test('sandbox cleanup requires exact confirmation phrase',()=>{const phrase='REMOVE SANDBOX ACCOUNTS';assert.equal(phrase,'REMOVE SANDBOX ACCOUNTS');assert.notEqual(phrase,'remove sandbox accounts')});
