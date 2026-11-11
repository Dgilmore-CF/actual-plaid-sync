const SAFE_PLAID_CODES = new Set([
  'ITEM_LOGIN_REQUIRED',
  'INVALID_ACCESS_TOKEN',
  'INVALID_CREDENTIALS',
  'INVALID_FIELD',
  'INVALID_REQUEST',
  'INSTITUTION_DOWN',
  'INSTITUTION_NOT_RESPONDING',
  'PRODUCT_NOT_READY',
  'RATE_LIMIT_EXCEEDED',
  'TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION',
  'USER_PERMISSION_REVOKED',
]);

const SAFE_RUNTIME_CODES = new Set([
  'SQLITE_BUSY',
  'SQLITE_CONSTRAINT',
  'SQLITE_ERROR',
  'SQLITE_MISUSE',
  'SQLITE_READONLY',
  'ECONNREFUSED',
  'ECONNRESET',
  'EAI_AGAIN',
  'ENOTFOUND',
  'ETIMEDOUT',
  'ERR_INVALID_ARG_TYPE',
  'ERR_SQLITE_ERROR',
]);

const SAFE_ERROR_NAMES = new Set([
  'Error',
  'TypeError',
  'RangeError',
  'ReferenceError',
  'SyntaxError',
  'AggregateError',
  'FetchError',
  'SqliteError',
]);

const SAFE_SOURCE_FILES = new Set([
  'actual.js',
  'categories.js',
  'history-recovery.js',
  'lifecycle-actions.js',
  'plaid-pagination.js',
  'reconciliation.js',
  'server.js',
  'sync.js',
  'transform.js',
]);

function sourceLocation(error) {
  const stack = typeof error?.stack === 'string' ? error.stack : '';
  for (const line of stack.split('\n')) {
    const match = line.match(/(?:file:\/\/)?[^\s()]*\/src\/([a-z0-9-]+\.js):(\d+):\d+/i);
    if (match && SAFE_SOURCE_FILES.has(match[1])) {
      return { errorSourceFile: match[1], errorSourceLine: Number(match[2]) };
    }
  }
  return { errorSourceFile: null, errorSourceLine: null };
}

export function classifySyncError(error) {
  const plaidCode = error?.response?.data?.error_code;
  const runtimeCode = error?.code;
  const httpStatus = Number(error?.response?.status || error?.statusCode);
  const sqliteBindingError = /provided value cannot be bound to sqlite parameter/i
    .test(String(error?.message || ''));
  const code = sqliteBindingError ? 'SQLITE_BINDING_ERROR'
    : SAFE_PLAID_CODES.has(plaidCode) ? plaidCode
      : SAFE_RUNTIME_CODES.has(runtimeCode) ? runtimeCode : null;
  const category = sqliteBindingError ? 'sqlite_binding'
    : SAFE_PLAID_CODES.has(plaidCode) ? 'plaid'
      : SAFE_RUNTIME_CODES.has(runtimeCode) && runtimeCode.startsWith('SQLITE_') ? 'sqlite'
        : SAFE_RUNTIME_CODES.has(runtimeCode) && /^(?:ECONN|EAI_|ENOTFOUND|ETIMEDOUT)/.test(runtimeCode) ? 'network'
          : Number.isInteger(httpStatus) && httpStatus >= 400 && httpStatus <= 599 ? 'http'
            : 'internal';
  const errorName = SAFE_ERROR_NAMES.has(error?.name) ? error.name : 'OtherError';
  return {
    errorCategory: category,
    errorCode: code,
    errorHttpStatus: Number.isInteger(httpStatus) && httpStatus >= 400 && httpStatus <= 599 ? httpStatus : null,
    errorName,
    ...sourceLocation(error),
  };
}

export function uncaughtExceptionSummary(error, origin) {
  const safeOrigin = origin === 'uncaughtException' || origin === 'unhandledRejection' ? origin : 'other';
  return { event: 'uncaught_exception', origin: safeOrigin, ...classifySyncError(error) };
}
