export async function confirmItemReconnect({
  itemId,
  loadItem,
  verifyItem,
  clearLastError,
}) {
  if (!itemId) throw new Error('Item ID is required');

  const existing = await loadItem(itemId);
  if (!existing) throw new Error('Unknown Plaid Item');

  const item = await verifyItem(existing);
  if (!item || item.item_id !== itemId || item.error) {
    throw new Error('Plaid Item still requires attention');
  }

  const updated = await clearLastError(itemId, existing.access_token_enc);
  if (!updated) throw new Error('Plaid Item changed during reconnect');

  return { reconnected: true };
}
