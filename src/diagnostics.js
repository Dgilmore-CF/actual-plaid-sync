const PRIVATE_KEYS = /^(?:[a-z0-9]+_)*(?:access_?token|secret|password|admin_?token|session_?secret|token_?encryption_?key|item_?id|account_?id|transaction_?id)$/i;

export function sanitizeDiagnostic(value) {
  if (Array.isArray(value)) return value.map(sanitizeDiagnostic);
  if (!value || typeof value !== 'object') return value;
  const result = {};
  for (const [key, nested] of Object.entries(value)) {
    const normalizedKey = key.replace(/([a-z0-9])([A-Z])/g, '$1_$2');
    if (PRIVATE_KEYS.test(normalizedKey)) continue;
    result[key] = sanitizeDiagnostic(nested);
  }
  return result;
}
