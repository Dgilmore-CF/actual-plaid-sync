import test from 'node:test';import assert from 'node:assert/strict';
import {dollarsToCents,reconciliationDifference} from '../src/money.js';
import {removalAction,isPendingReplacement} from '../src/transaction-policy.js';
test('balance conversion uses integer cents',()=>{assert.equal(dollarsToCents(500),50000);assert.equal(dollarsToCents(-25.1),-2510)});
test('reconciliation detects match and mismatch',()=>{assert.equal(reconciliationDifference(50000,50000),0);assert.equal(reconciliationDifference(50000,49500),500)});
test('pending removals can be deleted automatically',()=>assert.equal(removalAction({pending:1,actual_transaction_id:'a'}),'delete-pending'));
test('posted removals require review',()=>assert.equal(removalAction({pending:0,actual_transaction_id:'a'}),'review-posted'));
test('pending replacement is recognized',()=>assert.equal(isPendingReplacement({pending:false,pending_transaction_id:'old'}),true));
