export function createItemReconnectStore(database) {
  return {
    start(reconnectId, itemId) {
      database.prepare(`UPDATE item_reconnect_events
        SET status='failed',finished_at=CURRENT_TIMESTAMP,failure_code='expired'
        WHERE status='started' AND created_at < datetime('now','-1 day')`).run();
      database.prepare(`INSERT INTO item_reconnect_events(reconnect_id,item_id,status)
        VALUES(?,?,'started')`).run(reconnectId, itemId);
    },

    load(reconnectId) {
      return database.prepare(`SELECT reconnect_id,item_id,status,created_at,finished_at,failure_code
        FROM item_reconnect_events WHERE reconnect_id=?`).get(reconnectId);
    },

    fail(reconnectId, itemId, failureCode) {
      return database.prepare(`UPDATE item_reconnect_events
        SET status='failed',finished_at=CURRENT_TIMESTAMP,failure_code=?
        WHERE reconnect_id=? AND item_id=? AND status='started'`).run(failureCode, reconnectId, itemId).changes === 1;
    },

    finalize(itemId, reconnectId) {
      database.exec('BEGIN IMMEDIATE');
      try {
        const attempt = database.prepare(`SELECT item_id,status FROM item_reconnect_events
          WHERE reconnect_id=?`).get(reconnectId);
        if (!attempt || attempt.item_id !== itemId) {
          database.exec('ROLLBACK');
          return 'conflict';
        }
        if (attempt.status === 'completed') {
          database.exec('COMMIT');
          return 'already-completed';
        }
        if (attempt.status !== 'started') {
          database.exec('ROLLBACK');
          return 'conflict';
        }
        const item = database.prepare('SELECT 1 AS present FROM items WHERE item_id=?').get(itemId);
        if (!item) {
          database.exec('ROLLBACK');
          return 'conflict';
        }
        const eventUpdate = database.prepare(`UPDATE item_reconnect_events
          SET status='completed',finished_at=CURRENT_TIMESTAMP,failure_code=NULL
          WHERE reconnect_id=? AND item_id=? AND status='started'`).run(reconnectId, itemId);
        if (eventUpdate.changes !== 1) {
          database.exec('ROLLBACK');
          return 'conflict';
        }
        database.exec('COMMIT');
        return 'completed';
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    },

    cancel(itemId, reconnectId) {
      const update = database.prepare(`UPDATE item_reconnect_events
        SET status='cancelled',finished_at=CURRENT_TIMESTAMP
        WHERE reconnect_id=? AND item_id=? AND status='started'`).run(reconnectId, itemId);
      if (update.changes === 1) return 'cancelled';
      const attempt = database.prepare(`SELECT reconnect_id,item_id,status,created_at,finished_at,failure_code
        FROM item_reconnect_events WHERE reconnect_id=?`).get(reconnectId);
      if (!attempt || attempt.item_id !== itemId) return 'conflict';
      if (attempt.status === 'cancelled') return 'already-cancelled';
      if (attempt.status === 'completed') return 'already-completed';
      return 'conflict';
    },
  };
}
