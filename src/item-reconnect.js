export async function confirmItemReconnect({
  itemId,
  reconnectId,
  loadAttempt,
  loadItem,
  verifyItem,
  finalizeReconnect,
}) {
  if (!itemId || !reconnectId) throw new Error('Item ID and reconnect ID are required');

  const attempt = await loadAttempt(reconnectId);
  if (!attempt || attempt.item_id !== itemId) throw new Error('Unknown reconnect attempt');
  if (attempt.status === 'completed') return { reconnected: true, alreadyCompleted: true };
  if (attempt.status !== 'started') throw new Error('Reconnect attempt is not active');

  const existing = await loadItem(itemId);
  if (!existing) throw new Error('Unknown Plaid Item');

  const item = await verifyItem(existing);
  if (!item || item.item_id !== itemId || item.error) {
    throw new Error('Plaid Item still requires attention');
  }

  const result = await finalizeReconnect(itemId, reconnectId);
  if (result === 'already-completed') return { reconnected: true, alreadyCompleted: true };
  if (result !== 'completed') throw new Error('Reconnect attempt changed during verification');

  return { reconnected: true, alreadyCompleted: false };
}

export async function cancelItemReconnect({ itemId, reconnectId, loadAttempt, cancelAttempt }) {
  if (!itemId || !reconnectId) throw new Error('Item ID and reconnect ID are required');

  const attempt = await loadAttempt(reconnectId);
  if (!attempt || attempt.item_id !== itemId) throw new Error('Unknown reconnect attempt');
  if (attempt.status === 'cancelled') return { cancelled: true, alreadyCancelled: true };
  if (attempt.status === 'completed') return { cancelled: false, alreadyCompleted: true };
  if (attempt.status !== 'started') throw new Error('Reconnect attempt is not active');

  const result = await cancelAttempt(itemId, reconnectId);
  if (result === 'cancelled') return { cancelled: true, alreadyCancelled: false };
  if (result === 'already-cancelled') return { cancelled: true, alreadyCancelled: true };
  if (result === 'already-completed') return { cancelled: false, alreadyCompleted: true };
  throw new Error('Reconnect attempt changed before cancellation');
}
