import test from 'node:test';import assert from 'node:assert/strict';import {toActual,openingBalance} from '../src/transform.js';
test('debit becomes negative cents',()=>assert.equal(toActual({transaction_id:'1',date:'2026-01-01',amount:12.34,name:'Shop',pending:false}).amount,-1234));
test('credit becomes positive cents',()=>assert.equal(toActual({transaction_id:'2',date:'2026-01-01',amount:-50,name:'Pay',pending:false}).amount,5000));
test('pending is uncleared',()=>assert.equal(toActual({transaction_id:'3',date:'2026-01-01',amount:1,name:'Hold',pending:true}).cleared,false));
test('opening balance reconciles',()=>assert.equal(openingBalance(100,[{transaction_id:'4',date:'2026-01-01',amount:10,name:'Spend',pending:false}]),11000));
