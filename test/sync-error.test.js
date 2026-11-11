import test from 'node:test';
import assert from 'node:assert/strict';
import { classifySyncError, uncaughtExceptionSummary } from '../src/sync-error.js';

test('undefined SQLite bind failures are categorized without persisting the message', () => {
  const result = classifySyncError(new Error('Provided value cannot be bound to SQLite parameter 1'));
  assert.deepEqual(result, {
    errorCategory: 'sqlite_binding',
    errorCode: 'SQLITE_BINDING_ERROR',
    errorHttpStatus: null,
    errorName: 'Error',
    errorSourceFile: null,
    errorSourceLine: null,
  });
});

test('Plaid codes and HTTP status are returned as sanitized diagnostic fields', () => {
  assert.deepEqual(classifySyncError({
    name: 'Error',
    response: { status: 400, data: { error_code: 'INVALID_REQUEST' } },
  }), {
    errorCategory: 'plaid',
    errorCode: 'INVALID_REQUEST',
    errorHttpStatus: 400,
    errorName: 'Error',
    errorSourceFile: null,
    errorSourceLine: null,
  });
});

test('unknown error messages and codes never escape the safe summary', () => {
  const error = new Error('private account token and transaction detail');
  error.code = 'private-secret-value';
  const summary = classifySyncError(error);
  assert.deepEqual(summary, {
    errorCategory: 'internal',
    errorCode: null,
    errorHttpStatus: null,
    errorName: 'Error',
    errorSourceFile: null,
    errorSourceLine: null,
  });
  assert.doesNotMatch(JSON.stringify(summary), /private|account|transaction|secret/);
});

test('uncaught exception summaries restrict the process origin to known values', () => {
  assert.deepEqual(uncaughtExceptionSummary(new TypeError('secret'), 'unhandledRejection'), {
    event: 'uncaught_exception',
    origin: 'unhandledRejection',
    errorCategory: 'internal',
    errorCode: null,
    errorHttpStatus: null,
    errorName: 'TypeError',
    errorSourceFile: null,
    errorSourceLine: null,
  });
  assert.equal(uncaughtExceptionSummary(new Error(), 'arbitrary value').origin, 'other');
});

test('only known application source locations are retained', () => {
  const error = new Error('private details');
  error.stack = 'TypeError: private details\n    at sync (file:///app/src/sync.js:369:22)';
  assert.deepEqual(classifySyncError(error), {
    errorCategory: 'internal',
    errorCode: null,
    errorHttpStatus: null,
    errorName: 'Error',
    errorSourceFile: 'sync.js',
    errorSourceLine: 369,
  });
});
