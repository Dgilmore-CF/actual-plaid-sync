export class SyncCoordinator {
  #items = new Map();
  #maintenance = false;

  request(itemId, task, { queueIfActive = false } = {}) {
    if (this.#maintenance) return Promise.resolve({ itemId, status: 'maintenance' });
    const current = this.#items.get(itemId);
    if (current?.active) {
      if (queueIfActive) current.queued = true;
      return Promise.resolve({
        itemId,
        status: current.queued ? 'queued' : 'active',
      });
    }

    const state = { active: true, queued: false, promise: null };
    this.#items.set(itemId, state);
    state.promise = this.#run(itemId, state, task);
    return state.promise;
  }

  async #run(itemId, state, task) {
    let result;
    let error;
    try {
      do {
        state.queued = false;
        try {
          result = await task();
          error = null;
        } catch (caught) {
          error = caught;
        }
      } while (state.queued);
      if (error) throw error;
      return result;
    } finally {
      state.active = false;
      if (this.#items.get(itemId) === state) this.#items.delete(itemId);
    }
  }

  status(itemId) {
    const state = this.#items.get(itemId);
    if (!state) return 'idle';
    return state.queued ? 'queued' : 'active';
  }

  isActive(itemId) {
    return this.#items.has(itemId);
  }

  activeItemIds() {
    return [...this.#items.keys()];
  }

  async drain() {
    await Promise.allSettled([...this.#items.values()].map(state => state.promise));
  }

  async withNoSync(task) {
    if (this.#maintenance || this.#items.size) throw new Error('A synchronization is active');
    this.#maintenance = true;
    try {
      return await task();
    } finally {
      this.#maintenance = false;
    }
  }
}

export const syncCoordinator = new SyncCoordinator();

export function queueWebhookSync(coordinator, itemId, task) {
  return coordinator.request(itemId, task, { queueIfActive: true });
}
