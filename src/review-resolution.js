export async function resolveAndRefreshReview({ withNoSync, resolve, refresh, itemId, id, action, options }) {
  const result = await withNoSync(() => resolve(id, action, options));
  try {
    result.reconciliation = await refresh(itemId);
  } catch {
    result.reconciliationUnavailable = true;
  }
  return result;
}
