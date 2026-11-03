import test from 'node:test';import assert from 'node:assert/strict';import {toActual,openingBalance,reconcile} from '../src/transform.js';
test('debit sign',()=>assert.equal(toActual({transaction_id:'1',date:'2026-01-01',amount:12.34,name:'Shop',pending:false}).amount,-1234));
test('credit sign',()=>assert.equal(toActual({transaction_id:'2',date:'2026-01-01',amount:-50,name:'Pay',pending:false}).amount,5000));
test('pending uncleared',()=>assert.equal(toActual({transaction_id:'3',date:'2026-01-01',amount:1,name:'Hold',pending:true}).cleared,false));
test('opening reconciles',()=>{const t=[{transaction_id:'4',date:'2026-01-01',amount:10,name:'Spend',pending:false}],o=openingBalance(100,t);assert.equal(o,11000);assert.equal(reconcile(100,o,t),0)});
