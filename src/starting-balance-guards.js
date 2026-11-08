export function startingBalanceGuards(input) {
  return {
    historyReady: Boolean(input.historyReady),
    exactlyOneStartingBalance: input.startingBalanceCount === 1,
    noDuplicateImportedIds: input.duplicateImportedIdCount === 0,
    noUnresolvedPendingCandidates: input.pendingCandidateCount === 0,
    noUnresolvedRemovedPostedReviews: input.removedPostedCount === 0,
    actualSumMatchesApiBalance: input.transactionSumCents === input.actualBalanceCents,
    noSyncActive: Boolean(input.noSyncActive),
  };
}
