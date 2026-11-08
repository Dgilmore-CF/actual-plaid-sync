export const ACTIVE_MAPPING_SQL = 'enabled=1 AND initial_import_complete=1 AND actual_account_id IS NOT NULL';

export function isEligibleMapping(mapping) {
  return Number(mapping?.enabled) === 1 && Number(mapping?.initial_import_complete) === 1 && Boolean(mapping?.actual_account_id);
}

export function hasEligibleMapping(mappings) {
  return mappings.some(isEligibleMapping);
}

export function eligibleItemIds(database) {
  return database.prepare(`SELECT DISTINCT item_id FROM mappings WHERE ${ACTIVE_MAPPING_SQL} ORDER BY item_id`)
    .all().map(row => row.item_id);
}

export async function runEligibleItems(database, runItem) {
  const ids = eligibleItemIds(database);
  return Promise.all(ids.map(async itemId => {
    try { return { itemId, ok: true, result: await runItem(itemId) }; }
    catch (error) { return { itemId, ok: false, error: String(error?.message || error) }; }
  }));
}
