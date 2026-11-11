const REAUTHENTICATION_ERROR_CODES = new Set([
  'ITEM_LOGIN_REQUIRED',
  'INVALID_ACCESS_TOKEN',
  'INVALID_CREDENTIALS',
  'USER_PERMISSION_REVOKED',
  'USER_SETUP_REQUIRED',
]);

export function plaidItemStatus(item) {
  if (!item || item.error) {
    const code = item?.error?.error_code;
    return code && REAUTHENTICATION_ERROR_CODES.has(code) ? 'reauth_required' : 'unavailable';
  }
  return 'healthy';
}

export async function checkPlaidItemStatus(loadItem) {
  try {
    return plaidItemStatus(await loadItem());
  } catch {
    return 'unavailable';
  }
}
