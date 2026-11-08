export async function fetchTransactionChanges(fetchPage, { cursor, fromBeginning = false, onPage } = {}) {
  const original = fromBeginning ? undefined : cursor ?? undefined;
  let nextCursor = original;
  const changes = { added: [], modified: [], removed: [] };
  let hasMore = true;
  while (hasMore) {
    try {
      const page = await fetchPage({ cursor: nextCursor, count: 500 });
      changes.added.push(...page.added);
      changes.modified.push(...page.modified);
      changes.removed.push(...page.removed);
      nextCursor = page.next_cursor;
      hasMore = page.has_more;
      onPage?.();
    } catch (error) {
      if (error?.response?.data?.error_code === 'TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION') {
        nextCursor = original;
        changes.added.length = 0;
        changes.modified.length = 0;
        changes.removed.length = 0;
        hasMore = true;
        continue;
      }
      throw error;
    }
  }
  return { ...changes, cursor: nextCursor };
}
