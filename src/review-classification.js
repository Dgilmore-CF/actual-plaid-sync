export const LEGACY_ARCHIVE_CONFIRMATION = 'ARCHIVE LEGACY REVIEWS';

export function isProductionOpenReview(review) {
  return review.environment === 'production' && review.resolved_at == null && review.archived_at == null;
}

export function reviewMatchesFilter(review, filter) {
  switch (filter) {
    case 'production-open': return isProductionOpenReview(review);
    case 'needs-match': return review.reason === 'pending_to_posted_unmatched' && review.resolved_at == null && review.archived_at == null;
    case 'removed-posted': return review.reason === 'removed_posted' && review.resolved_at == null && review.archived_at == null;
    case 'legacy-test': return review.environment !== 'production';
    case 'resolved': return review.resolved_at != null;
    case 'all': return true;
    default: return false;
  }
}

export function recordReviewResolution(database, reviewId, action, details = {}) {
  return database.prepare('INSERT INTO review_resolutions(review_id,action,details) VALUES(?,?,?)')
    .run(reviewId, action, JSON.stringify(details));
}

export function archiveLegacyReviewsInDatabase(database, confirmation) {
  if (confirmation !== LEGACY_ARCHIVE_CONFIRMATION) throw new Error('Archival confirmation phrase does not match');
  const records = database.prepare(`SELECT id FROM review_queue
    WHERE (environment IS NULL OR environment<>'production')
      AND resolved_at IS NULL AND archived_at IS NULL`).all();
  database.exec('BEGIN IMMEDIATE');
  try {
    for (const record of records) {
      const details = { reason: 'Legacy or test review archived by operator' };
      database.prepare(`UPDATE review_queue SET archived_at=CURRENT_TIMESTAMP,archive_reason=? WHERE id=?`)
        .run(details.reason, record.id);
      recordReviewResolution(database, record.id, 'archived', details);
    }
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
  return { archived: records.length, deleted: 0 };
}
