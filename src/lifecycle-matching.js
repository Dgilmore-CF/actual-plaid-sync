const DAY_MS = 24 * 60 * 60 * 1000;

export function extractPostedTransaction(payload) {
  if (payload?.posted?.transaction_id) return payload.posted;
  if (payload?.transaction?.transaction_id) return payload.transaction;
  return payload?.transaction_id ? payload : null;
}

export function normalizeMerchant(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/(?:store|location)\s*#?\s*\d+|#\s*\d+/g, ' ')
    .replace(/(?:card\s*)?(?:ending|ends)\s*(?:in|with)?\s*\d{2,6}/g, ' ')
    .replace(/\bcard\s*#?\s*\d{2,6}\b/g, ' ')
    .replace(/\b(?:store|location)\s*#?\s*\d+\b/g, ' ')
    .replace(/\b(?:pending|posted)\b/g, ' ')
    .replace(/\b(?:card|debit|credit)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizedDate(value) {
  const time = Date.parse(`${String(value || '').slice(0, 10)}T00:00:00Z`);
  return Number.isFinite(time) ? time : null;
}

function tokenOverlap(left, right) {
  const a = new Set(left.split(' ').filter(Boolean));
  const b = new Set(right.split(' ').filter(Boolean));
  const shared = [...a].filter(token => b.has(token)).length;
  const denominator = Math.min(a.size, b.size);
  return { shared, ratio: denominator ? shared / denominator : 0 };
}

export function scorePendingCandidate(posted, candidate) {
  const postedAmount = Math.round(Number(posted.actualAmountCents));
  const pendingAmount = Math.round(Number(candidate.amount));
  const amountDifferenceCents = Math.abs(postedAmount - pendingAmount);
  const amountBase = Math.max(Math.abs(postedAmount), Math.abs(pendingAmount), 1);
  const amountRatio = amountDifferenceCents / amountBase;
  const postedMerchant = normalizeMerchant(posted.merchant);
  const candidateMerchant = normalizeMerchant(candidate.payee_name || candidate.merchant);
  const overlap = tokenOverlap(postedMerchant, candidateMerchant);
  const merchantSimilarity = postedMerchant && postedMerchant === candidateMerchant
    ? 'exact'
    : overlap.shared >= 2 && overlap.ratio >= 0.6 ? 'strong' : 'none';
  const postedDate = normalizedDate(posted.date);
  const candidateDate = normalizedDate(candidate.date);
  const dateDifferenceDays = postedDate == null || candidateDate == null
    ? null
    : Math.abs(postedDate - candidateDate) / DAY_MS;

  let score = 0;
  if (amountDifferenceCents === 0) score += 50;
  else if (amountDifferenceCents <= 100) score += 35;
  else if (amountRatio <= 0.1) score += 15;
  if (merchantSimilarity === 'exact') score += 35;
  else if (merchantSimilarity === 'strong') score += 20;
  if (dateDifferenceDays != null && dateDifferenceDays <= 1) score += 15;
  else if (dateDifferenceDays != null && dateDifferenceDays <= 3) score += 10;
  else if (dateDifferenceDays != null && dateDifferenceDays <= 7) score += 5;
  if (candidate.pending === true || candidate.cleared === false) score += 20;

  return {
    score,
    amountDifferenceCents,
    amountDifference: amountDifferenceCents / 100,
    amountRatio,
    dateDifferenceDays,
    merchantSimilarity,
    confidence: score >= 80 ? 'high' : score >= 50 ? 'medium' : 'low',
  };
}

export function findPendingCandidates(posted, candidates, actualAccountId) {
  const postedMerchant = normalizeMerchant(posted.merchant);
  return candidates
    .filter(candidate => candidate.actual_account_id === actualAccountId)
    .filter(candidate => candidate.cleared === false || candidate.pending === true)
    .filter(candidate => candidate.imported_id?.startsWith('plaid:') && !candidate.imported_id.startsWith('plaid:opening:'))
    .filter(candidate => !candidate.linkedToPosted)
    .map(candidate => ({ candidate, analysis: scorePendingCandidate(posted, candidate) }))
    .filter(({ analysis }) => analysis.dateDifferenceDays != null && analysis.dateDifferenceDays <= 7)
    .filter(({ analysis }) => analysis.amountDifferenceCents <= 100 || analysis.amountRatio <= 0.1)
    .filter(({ candidate }) => {
      const merchant = normalizeMerchant(candidate.payee_name || candidate.merchant);
      const overlap = tokenOverlap(postedMerchant, merchant);
      return postedMerchant === merchant || (overlap.shared >= 2 && overlap.ratio >= 0.6);
    })
    .sort((left, right) => right.analysis.score - left.analysis.score || String(left.candidate.id).localeCompare(String(right.candidate.id)));
}

export function selectPendingMatch(scoredCandidates) {
  const top = scoredCandidates[0];
  const second = scoredCandidates[1];
  const margin = top ? top.analysis.score - (second?.analysis.score || 0) : 0;
  return {
    candidate: top?.candidate || null,
    analysis: top?.analysis || null,
    margin,
    automatic: Boolean(top && top.analysis.score >= 80 && margin >= 20),
  };
}
