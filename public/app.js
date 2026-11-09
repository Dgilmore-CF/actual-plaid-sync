const $ = selector => document.querySelector(selector);
const money = cents => (Number(cents || 0) / 100).toLocaleString(undefined, { style: 'currency', currency: 'USD' });
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
let state;
let modalAction;
let activeReviewFilter = 'production-open';
const token = () => sessionStorage.adminToken || '';
const archived = () => JSON.parse(localStorage.archivedInstitutions || '[]');
const collapsed = () => JSON.parse(localStorage.collapsedInstitutions || '[]');
const save = (key, value) => { localStorage[key] = JSON.stringify(value); };

async function api(path, options = {}) {
  options.headers = { ...(options.headers || {}), 'content-type': 'application/json', 'x-admin-token': token() };
  const response = await fetch(path, options);
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || response.statusText);
  return result;
}

function note(message, isError = false) {
  const region = $('#notice');
  region.textContent = message;
  region.className = isError ? 'notice-error' : 'notice-good';
  window.setTimeout(() => { region.textContent = ''; region.className = ''; }, 7000);
}

function output(value) { $('#output').textContent = JSON.stringify(value, null, 2); }
function isDebt(mapping) { return mapping.plaid_type === 'credit' || mapping.plaid_type === 'loan'; }
function view(name) {
  document.querySelectorAll('.view').forEach(element => element.classList.remove('active'));
  document.querySelectorAll('nav button').forEach(element => element.classList.toggle('active', element.dataset.view === name));
  $(`#${name}`).classList.add('active');
}

function render() {
  const mappings = state.mappings || [];
  const items = state.items || [];
  const active = mappings.filter(mapping => mapping.enabled && mapping.initial_import_complete && mapping.actual_account_id);
  $('#auth').classList.add('hidden');
  $('#meta').textContent = `${state.version} | ${state.plaidEnvironment}`;
  $('#reviewCount').textContent = String(state.reviewCounts?.productionOpen || 0);
  $('#metrics').innerHTML = [
    [items.length, 'Institutions'],
    [active.length, 'Syncing accounts'],
    [active.filter(mapping => ['reconciled', 'reconciled-pending'].includes(mapping.reconciliation_status)).length, 'Reconciled'],
    [state.reviewCounts?.productionOpen || 0, 'Production reviews'],
  ].map(([count, label]) => `<div class="metric"><strong>${escapeHtml(count)}</strong><span>${escapeHtml(label)}</span></div>`).join('');
  $('#homeAccounts').innerHTML = active.map(mapping => {
    const status = mapping.reconciliation_explanation || mapping.reconciliation_status || 'unknown';
    const difference = mapping.posted_reconciliation_difference_cents;
    return `<article class="card">
      <div class="row"><strong>${escapeHtml(mapping.actual_account_name || mapping.plaid_name)}</strong><span class="badge ${['reconciled', 'reconciled-pending', 'Reconciled', 'Reconciled with pending activity'].includes(status) ? 'good' : 'warn'}">${escapeHtml(status)}</span></div>
      <p class="subtle">${isDebt(mapping) ? 'Amount owed' : 'Projected balance'}</p>
      <h2>${money(mapping.actual_projected_balance_cents)}</h2>
      <p class="subtle">Posted difference: ${money(difference)}</p>
      <div class="account-actions"><button data-investigate="${escapeHtml(mapping.plaid_account_id)}">Investigate mismatch</button><button data-starting-preview="${escapeHtml(mapping.plaid_account_id)}">Preview Starting Balance</button></div>
    </article>`;
  }).join('') || '<div class="empty">No approved account mappings yet.</div>';
  renderConnections();
  renderReviews();
  $('#system').innerHTML = `<p>Version <b>${escapeHtml(state.version)}</b> | Environment <b>${escapeHtml(state.plaidEnvironment)}</b></p>`;
  bindDashboardActions();
}

function renderConnections() {
  const query = $('#search').value.toLowerCase();
  const filter = $('#filter').value;
  const archivedItems = archived();
  const collapsedItems = collapsed();
  const mappings = state.mappings || [];
  const accountOptions = (state.actualAccounts || []).filter(account => !account.closed)
    .map(account => `<option value="${escapeHtml(account.id)}">${escapeHtml(account.name)}</option>`).join('');
  const items = state.items.filter(item => {
    const itemMappings = mappings.filter(mapping => mapping.item_id === item.item_id);
    const isArchived = archivedItems.includes(item.item_id);
    const text = `${item.institution_name} ${itemMappings.map(mapping => `${mapping.plaid_name} ${mapping.plaid_mask}`).join(' ')}`.toLowerCase();
    if (query && !text.includes(query)) return false;
    if (filter === 'archived') return isArchived;
    if (isArchived) return false;
    if (filter === 'active') return item.automatic_sync;
    if (filter === 'setup') return itemMappings.some(mapping => !mapping.actual_account_id || !mapping.initial_import_complete);
    if (filter === 'unmapped') return itemMappings.some(mapping => !mapping.actual_account_id);
    return true;
  });

  $('#connectionList').innerHTML = items.length ? items.map(item => {
    const itemMappings = mappings.filter(mapping => mapping.item_id === item.item_id);
    const isArchived = archivedItems.includes(item.item_id);
    const isCollapsed = collapsedItems.includes(item.item_id) || (!localStorage.collapsedInitialized && itemMappings.length > 5);
    const status = item.automatic_sync ? item.sync_status : 'Excluded from automatic synchronization';
    return `<article class="institution ${isArchived ? 'archived' : ''}">
      <div class="institution-head"><div><h2>${escapeHtml(item.institution_name)}</h2>
      <p>${itemMappings.length} accounts | ${itemMappings.filter(mapping => mapping.enabled).length} enabled | ${escapeHtml(status)} | Last sync ${escapeHtml(item.last_sync_at || 'Never')}</p></div>
      <div class="institution-tools"><button data-reconnect="${escapeHtml(item.item_id)}">Reconnect with Plaid</button><button data-sync-item="${escapeHtml(item.item_id)}">Sync Item</button><button data-archive="${escapeHtml(item.item_id)}">${isArchived ? 'Restore' : 'Archive'}</button><button data-collapse="${escapeHtml(item.item_id)}">${isCollapsed ? 'Expand' : 'Collapse'}</button></div></div>
      <div class="account-list ${isCollapsed ? 'hidden' : ''}">${itemMappings.map(mapping => renderAccount(mapping, accountOptions, item)).join('')}</div>
    </article>`;
  }).join('') : '<div class="empty">No connections match this view.</div>';
  localStorage.collapsedInitialized = '1';
  bindConnectionActions();
}

function renderAccount(mapping, accountOptions, item) {
  const approved = Boolean(mapping.initial_import_complete);
  const excluded = !item.automatic_sync;
  const status = excluded ? 'Excluded from automatic synchronization' : (mapping.reconciliation_status || 'unknown');
  return `<div class="account"><div class="account-top"><div><h3>${escapeHtml(mapping.plaid_name)} | ${escapeHtml(mapping.plaid_mask || 'No mask')}</h3>
    <div class="subtle">${escapeHtml(mapping.plaid_type)} / ${escapeHtml(mapping.plaid_subtype)} | ${escapeHtml(status)}</div></div>
    <span class="badge ${status === 'reconciled' || status === 'reconciled-pending' ? 'good' : 'warn'}">${escapeHtml(status)}</span></div>
    <div class="balances"><div class="balance"><span>${isDebt(mapping) ? 'Amount owed' : 'Posted balance'}</span><strong>${money(mapping.actual_cleared_balance_cents ?? mapping.plaid_current_balance_cents)}</strong></div>
    <div class="balance"><span>Pending</span><strong>${money(mapping.actual_pending_balance_cents)}</strong></div>
    <div class="balance"><span>Projected</span><strong>${money(mapping.actual_projected_balance_cents)}</strong></div></div>
    <div class="account-actions">${mapping.actual_account_id
      ? `<button data-rename="${escapeHtml(mapping.actual_account_id)}" data-name="${escapeHtml(mapping.actual_account_name || '')}">Rename Actual account</button>`
      : `<select data-map="${escapeHtml(mapping.plaid_account_id)}"><option value="">Map to Actual...</option>${accountOptions}</select>`}
      ${mapping.actual_account_id && !approved ? `<button data-preview="${escapeHtml(mapping.plaid_account_id)}">Preview import</button><button class="primary" data-approve="${escapeHtml(mapping.plaid_account_id)}">Approve import</button>` : ''}
      ${approved ? `<button data-history="${escapeHtml(mapping.plaid_account_id)}">Check history</button><button data-recover="${escapeHtml(mapping.plaid_account_id)}">Recover missing history</button>` : ''}
      <button data-investigate="${escapeHtml(mapping.plaid_account_id)}">Investigate mismatch</button></div></div>`;
}

function renderReviewDetails(review) {
  const payload = review.payload || {};
  if (review.reason === 'pending_to_posted_unmatched') {
    const posted = payload.posted || {};
    const existingPosted = payload.postedAlreadyImported;
    return `<div class="review-details"><h3>Posted transaction</h3><p>${escapeHtml(posted.merchant)} | ${escapeHtml(posted.date)} | ${money(posted.amountCents)} | Plaid ID suffix ${escapeHtml(posted.plaidIdSuffix)} | ${escapeHtml(review.account || posted.account)} | Category ${escapeHtml(posted.category || 'Uncategorized')}</p>
      ${existingPosted ? `<h3>Already imported posted Actual transaction</h3><p>${escapeHtml(existingPosted.payee)} | ${escapeHtml(existingPosted.date)} | ${money(existingPosted.amountCents)} | Actual ID suffix ${escapeHtml(existingPosted.actualIdSuffix)} | Category ${escapeHtml(existingPosted.category || 'Uncategorized')} | ${existingPosted.cleared ? 'Cleared' : 'Uncleared'}</p>` : ''}
      <h3>Match analysis</h3><p>Top score ${escapeHtml(payload.topScore)} | Confidence ${escapeHtml(payload.confidence)} | Margin ${escapeHtml(payload.margin)}</p>
      ${(payload.candidates || []).map(candidate => `<div class="candidate"><p>Candidate: ${escapeHtml(candidate.payee)} | ${escapeHtml(candidate.date)} | ${money(candidate.amountCents)} | ${candidate.cleared ? 'Cleared' : 'Uncleared'} | Actual ID suffix ${escapeHtml(candidate.actualIdSuffix)} | Imported ID suffix ${escapeHtml(candidate.importedIdSuffix)} | Category ${escapeHtml(candidate.category || 'Uncategorized')}</p>
      <p>Score ${escapeHtml(candidate.score)} | ${escapeHtml(candidate.confidence)} confidence | Date difference ${escapeHtml(candidate.dateDifferenceDays)} days | Amount difference ${money(candidate.amountDifferenceCents)} | Merchant ${escapeHtml(candidate.merchantSimilarity)}</p>
      <div class="account-actions"><button data-review-action="replace_pending" data-review-id="${review.id}" data-candidate="${escapeHtml(candidate.actualIdSuffix)}">Replace pending with posted</button><button data-review-action="delete_stale_pending" data-review-id="${review.id}" data-candidate="${escapeHtml(candidate.actualIdSuffix)}">Delete stale pending</button></div></div>`).join('')}
      ${!(payload.candidates || []).length ? `<button data-review-investigate="${review.id}">Find pending candidates</button>` : ''}
      <div class="account-actions"><button data-review-action="keep_both" data-review-id="${review.id}">Keep both</button><button data-review-action="no_match" data-review-id="${review.id}">No matching pending transaction</button></div></div>`;
  }
  return `<div class="review-details"><p>Account: ${escapeHtml(payload.account || review.account)} | Payee: ${escapeHtml(payload.payee || 'Unknown')} | Date: ${escapeHtml(payload.date || 'Unknown')} | Amount: ${money(payload.amountCents)} | Pending: ${Boolean(payload.pending)} | Cleared: ${Boolean(payload.cleared)} | Category: ${escapeHtml(payload.category || 'Uncategorized')}</p>
    <p>Plaid ID suffix ${escapeHtml(payload.plaidTransactionIdSuffix || '')} | Actual ID suffix ${escapeHtml(payload.actualTransactionIdSuffix || '')} | Imported ID suffix ${escapeHtml(payload.importedIdSuffix || '')} | Reason ${escapeHtml(payload.reason || review.reason)}</p>
    ${review.resolved_at ? '' : `<div class="account-actions"><button data-review-action="keep" data-review-id="${review.id}">Keep</button>${review.reason === 'removed_posted' ? `<button data-review-action="delete" data-review-id="${review.id}">Delete reviewed transaction</button>` : ''}<button data-review-action="resolve" data-review-id="${review.id}">Resolve without ledger change</button></div>`}</div>`;
}

function renderReviews() {
  const reviews = state.reviews || [];
  $('#reviewList').innerHTML = reviews.map(review => `<article class="card review-card">
    <div class="row"><strong>${escapeHtml(review.reason)}</strong><span class="badge ${review.resolved_at ? 'good' : 'warn'}">${escapeHtml(review.environment)}</span></div>
    <p>${escapeHtml(review.account)} | ${escapeHtml(review.created_at)}${review.archived_at ? ` | Archived ${escapeHtml(review.archived_at)}` : ''}</p>
    ${renderReviewDetails(review)}
    ${!review.resolved_at && !review.archived_at ? `<div class="classification"><label>Environment <select data-classify-env="${review.id}"><option value="legacy_unknown" ${review.environment === 'legacy_unknown' ? 'selected' : ''}>Legacy/unknown</option><option value="production" ${review.environment === 'production' ? 'selected' : ''}>Production</option><option value="sandbox" ${review.environment === 'sandbox' ? 'selected' : ''}>Sandbox/test</option></select></label><label>Source Item <select data-classify-status="${review.id}"><option value="unknown" ${review.source_item_status === 'unknown' ? 'selected' : ''}>Unknown</option><option value="active" ${review.source_item_status === 'active' ? 'selected' : ''}>Active</option><option value="excluded" ${review.source_item_status === 'excluded' ? 'selected' : ''}>Excluded</option><option value="removed" ${review.source_item_status === 'removed' ? 'selected' : ''}>Removed</option></select></label><button data-classify="${review.id}">Save classification</button></div>` : ''}
  </article>`).join('') || '<div class="empty">No reviews match this filter.</div>';
  $('#archiveLegacy').classList.toggle('hidden', activeReviewFilter !== 'legacy-test');
  bindReviewActions();
}

function modal(title, message, action, initialValue = '') {
  $('#modalTitle').textContent = title;
  $('#modalMessage').textContent = message;
  $('#modalInput').value = initialValue;
  $('#modalLabelText').textContent = 'Confirmation';
  $('#modalLabel').classList.remove('hidden');
  modalAction = action;
  $('#modal').classList.remove('hidden');
  $('#modalInput').focus();
}

function closeModal() { $('#modal').classList.add('hidden'); modalAction = null; }

async function refresh() {
  try {
    state = await api('/api/status');
    state.reviews = (await api(`/api/reviews?filter=${encodeURIComponent(activeReviewFilter)}`)).reviews;
    render();
  } catch (error) { note(error.message, true); }
}

function bindConnectionActions() {
  document.querySelectorAll('[data-reconnect]').forEach(button => button.onclick = async () => {
    const itemId = button.dataset.reconnect;
    let reconnectId;
    let completed = false;
    button.disabled = true;
    const cancelAttempt = async () => {
      if (!reconnectId) return;
      try { await api('/api/reconnect/cancel', { method: 'POST', body: JSON.stringify({ itemId, reconnectId }) }); } catch {}
    };
    const failAttempt = async failureCode => {
      if (!reconnectId) return;
      try { await api('/api/reconnect/fail', { method: 'POST', body: JSON.stringify({ itemId, reconnectId, failureCode }) }); } catch {}
    };
    try {
      const result = await api('/api/link-token', { method: 'POST', body: JSON.stringify({ itemId }) });
      reconnectId = result.reconnectId;
      if (!reconnectId) throw new Error('Reconnect attempt was not created');
      Plaid.create({
        token: result.link_token,
        onSuccess: async () => {
          if (completed) return;
          completed = true;
          note('Plaid Link completed. Verifying the existing Item…');
          try {
            await api('/api/reconnect', { method: 'POST', body: JSON.stringify({ itemId, reconnectId }) });
            note('Plaid confirmed the existing connection. Use Sync Item to verify access.');
            await refresh();
          } catch {
            note('Reconnect could not be confirmed. The app kept the existing Item and mappings.', true);
          } finally { button.disabled = false; }
        },
        onExit: async error => {
          if (completed) return;
          completed = true;
          if (error) {
            await failAttempt('link_exit_error');
            note('Plaid Link could not complete. The existing Item and mappings were not changed.', true);
          } else {
            await cancelAttempt();
            note('Reconnect cancelled. The existing connection was not changed.');
          }
          button.disabled = false;
        },
      }).open();
      note('Complete the bank sign-in and any MFA in Plaid Link.');
    } catch {
      if (!completed) {
        completed = true;
        await failAttempt('link_initialization_failed');
      }
      note('Could not start Plaid reconnect. The existing connection was not changed.', true);
      button.disabled = false;
    }
  });
  document.querySelectorAll('[data-collapse]').forEach(button => button.onclick = () => {
    const values = collapsed();
    save('collapsedInstitutions', values.includes(button.dataset.collapse) ? values.filter(value => value !== button.dataset.collapse) : [...values, button.dataset.collapse]);
    renderConnections();
  });
  document.querySelectorAll('[data-archive]').forEach(button => button.onclick = () => {
    const values = archived();
    save('archivedInstitutions', values.includes(button.dataset.archive) ? values.filter(value => value !== button.dataset.archive) : [...values, button.dataset.archive]);
    renderConnections();
  });
  document.querySelectorAll('[data-sync-item]').forEach(button => button.onclick = async () => {
    try { output(await api('/api/sync', { method: 'POST', body: JSON.stringify({ itemId: button.dataset.syncItem }) })); await refresh(); }
    catch (error) { note(error.message, true); }
  });
  document.querySelectorAll('[data-map]').forEach(select => select.onchange = async () => {
    try {
      await api('/api/mappings', { method: 'POST', body: JSON.stringify({ plaidAccountId: select.dataset.map, actualAccountId: select.value || null, actualAccountName: select.selectedOptions[0]?.text || null, offbudget: false, enabled: Boolean(select.value) }) });
      await refresh();
    } catch (error) { note(error.message, true); }
  });
  document.querySelectorAll('[data-rename]').forEach(button => button.onclick = () => modal('Rename Actual account', 'Enter the new account name.', async value => {
    await api(`/api/accounts/${encodeURIComponent(button.dataset.rename)}/rename`, { method: 'POST', body: JSON.stringify({ name: value }) });
    await refresh();
  }, button.dataset.name));
  document.querySelectorAll('[data-preview]').forEach(button => button.onclick = async () => {
    try { output(await api('/api/initial/preview', { method: 'POST', body: JSON.stringify({ plaidAccountId: button.dataset.preview }) })); }
    catch (error) { note(error.message, true); }
  });
  document.querySelectorAll('[data-approve]').forEach(button => button.onclick = () => modal('Approve initial import', 'The Actual budget backup is created before importing. Type APPROVE INITIAL IMPORT to continue.', async value => {
    if (value !== 'APPROVE INITIAL IMPORT') throw new Error('Confirmation phrase does not match');
    output(await api('/api/initial/approve', { method: 'POST', body: JSON.stringify({ plaidAccountId: button.dataset.approve }) }));
    await refresh();
  }));
  document.querySelectorAll('[data-history]').forEach(button => button.onclick = async () => {
    try { output(await api('/api/history/status', { method: 'POST', body: JSON.stringify({ plaidAccountId: button.dataset.history }) })); }
    catch (error) { note(error.message, true); }
  });
  document.querySelectorAll('[data-recover]').forEach(button => button.onclick = () => modal('Recover missing history', 'Creates an Actual backup, imports only missing transactions, and corrects the existing Starting Balance. Type RECOVER MISSING HISTORY.', async value => {
    if (value !== 'RECOVER MISSING HISTORY') throw new Error('Confirmation phrase does not match');
    output(await api('/api/history/recover', { method: 'POST', body: JSON.stringify({ plaidAccountId: button.dataset.recover, confirmation: value }) }));
    await refresh();
  }));
}

function bindDashboardActions() {
  document.querySelectorAll('[data-investigate]').forEach(button => button.onclick = async () => {
    try { output(await api(`/api/investigation/${encodeURIComponent(button.dataset.investigate)}`)); view('settings'); }
    catch (error) { note(error.message, true); }
  });
  document.querySelectorAll('[data-starting-preview]').forEach(button => button.onclick = async () => {
    try {
      const preview = await api('/api/starting-balance/preview', { method: 'POST', body: JSON.stringify({ plaidAccountId: button.dataset.startingPreview }) });
      output(preview);
      if (!preview.allowed) { note('Starting Balance recalculation is blocked by one or more safety guards.', true); view('settings'); return; }
      modal('Recalculate Starting Balance', `Account: ${preview.account}; current ${money(preview.currentStartingBalanceCents)}; proposed ${money(preview.proposedStartingBalanceCents)}; adjustment ${money(preview.adjustmentCents)}; balance before ${money(preview.balanceBeforeCents)}; balance after ${money(preview.balanceAfterCents)}; backup to create: ${preview.backupPath}. Type RECALCULATE STARTING BALANCE.`, async value => {
        if (value !== 'RECALCULATE STARTING BALANCE') throw new Error('Confirmation phrase does not match');
        output(await api('/api/starting-balance/recalculate', { method: 'POST', body: JSON.stringify({
          plaidAccountId: button.dataset.startingPreview,
          confirmation: value,
          expected: { adjustmentCents: preview.adjustmentCents, proposedStartingBalanceCents: preview.proposedStartingBalanceCents, backupPath: preview.backupPath },
        }) }));
        await refresh();
      });
    } catch (error) { note(error.message, true); }
  });
}

function resolveReview(button, action, extra = {}) {
  const reviewId = button.dataset.reviewId;
  return api(`/api/reviews/${reviewId}/resolve`, { method: 'POST', body: JSON.stringify({ action, ...extra }) });
}

function bindReviewActions() {
  document.querySelectorAll('[data-review-investigate]').forEach(button => button.onclick = async () => {
    try {
      const details = await api(`/api/reviews/${button.dataset.reviewInvestigate}`);
      state.reviews = state.reviews.map(review => review.id === details.id ? details : review);
      renderReviews();
    } catch (error) { note(error.message, true); }
  });
  document.querySelectorAll('[data-review-action]').forEach(button => button.onclick = async () => {
    const action = button.dataset.reviewAction;
    const extra = button.dataset.candidate ? { candidateActualIdSuffix: button.dataset.candidate } : {};
    try {
      if (action === 'delete_stale_pending') {
        const review = state.reviews.find(item => item.id === Number(button.dataset.reviewId));
        const candidate = review?.payload?.candidates?.find(item => item.actualIdSuffix === button.dataset.candidate);
        if (!candidate) throw new Error('Candidate details are unavailable; refresh the queue');
        const details = { account: review.account, payee: candidate.payee || '', date: candidate.date || '', amountCents: Number(candidate.amountCents) };
        modal('Delete stale pending transaction', `This deletes only the uncleared Actual transaction. Account: ${details.account}; payee: ${details.payee}; date: ${details.date}; amount: ${money(details.amountCents)}. An Actual backup is created first. Type DELETE STALE PENDING.`, async value => {
          if (value !== 'DELETE STALE PENDING') throw new Error('Confirmation phrase does not match');
          output(await resolveReview(button, action, { ...extra, confirmation: value, confirmedDetails: details }));
          await refresh();
        });
        return;
      }
      if (action === 'replace_pending') {
        const review = state.reviews.find(item => item.id === Number(button.dataset.reviewId));
        const posted = review?.payload?.postedAlreadyImported;
        if (posted) {
          const details = { account: review.account, payee: posted.payee || '', date: posted.date || '', amountCents: Number(posted.amountCents) };
          modal('Replace duplicate posted transaction', `This removes the already imported posted Actual row after an Actual backup, then updates the selected pending row in place. Account: ${details.account}; payee: ${details.payee}; date: ${details.date}; amount: ${money(details.amountCents)}. Type REPLACE EXISTING POSTED.`, async value => {
            if (value !== 'REPLACE EXISTING POSTED') throw new Error('Confirmation phrase does not match');
            output(await resolveReview(button, action, { ...extra, confirmation: value, confirmedPostedDetails: details }));
            await refresh();
          });
          return;
        }
      }
      if (action === 'delete') {
        const review = state.reviews.find(item => item.id === Number(button.dataset.reviewId));
        const payload = review?.payload || {};
        const details = { account: payload.account || review.account, payee: payload.payee || '', date: payload.date || '', amountCents: Number(payload.amountCents || 0) };
        modal('Delete reviewed transaction', `This is a posted transaction. It will not be deleted automatically. Account: ${details.account}; payee: ${details.payee}; date: ${details.date}; amount: ${money(details.amountCents)}. An Actual backup is created first. Type DELETE REVIEWED TRANSACTION.`, async value => {
          if (value !== 'DELETE REVIEWED TRANSACTION') throw new Error('Confirmation phrase does not match');
          output(await resolveReview(button, action, { confirmation: value, confirmedDetails: details }));
          await refresh();
        });
        return;
      }
      output(await resolveReview(button, action, extra));
      await refresh();
    } catch (error) { note(error.message, true); }
  });
  document.querySelectorAll('[data-classify]').forEach(button => button.onclick = async () => {
    const select = document.querySelector(`[data-classify-env="${button.dataset.classify}"]`);
    const sourceStatus = document.querySelector(`[data-classify-status="${button.dataset.classify}"]`);
    try {
      await api(`/api/reviews/${button.dataset.classify}/classify`, { method: 'POST', body: JSON.stringify({ environment: select.value, sourceItemStatus: sourceStatus.value }) });
      await refresh();
    } catch (error) { note(error.message, true); }
  });
}

document.querySelectorAll('nav button').forEach(button => button.onclick = () => view(button.dataset.view));
$('#token').value = token();
$('#save').onclick = () => { sessionStorage.adminToken = $('#token').value; refresh(); };
$('#sync').onclick = async () => {
  try { output(await api('/api/sync', { method: 'POST', body: '{}' })); await refresh(); }
  catch (error) { note(error.message, true); }
};
$('#search').oninput = renderConnections;
$('#filter').onchange = renderConnections;
$('#collapseAll').onclick = () => { save('collapsedInstitutions', state.items.map(item => item.item_id)); renderConnections(); };
$('#expandAll').onclick = () => { save('collapsedInstitutions', []); renderConnections(); };
$('#reviewFilter').onchange = async () => { activeReviewFilter = $('#reviewFilter').value; await refresh(); };
$('#archiveLegacy').onclick = () => modal('Archive legacy and test reviews', 'Records are retained and nothing is deleted. This excludes non-Production open reviews from the default queue. Type ARCHIVE LEGACY REVIEWS.', async value => {
  if (value !== 'ARCHIVE LEGACY REVIEWS') throw new Error('Confirmation phrase does not match');
  output(await api('/api/reviews/archive-legacy', { method: 'POST', body: JSON.stringify({ confirmation: value }) }));
  await refresh();
});
$('#backfillCategories').onclick = async () => {
  try { output(await api('/api/categories/backfill', { method: 'POST', body: '{}' })); note('Existing transactions categorized.'); await refresh(); }
  catch (error) { note(error.message, true); }
};
$('#link').onclick = async () => {
  try {
    const result = await api('/api/link-token', { method: 'POST', body: '{}' });
    Plaid.create({ token: result.link_token, onSuccess: async publicToken => {
      try { await api('/api/exchange', { method: 'POST', body: JSON.stringify({ publicToken }) }); await refresh(); }
      catch (error) { note(error.message, true); }
    } }).open();
  } catch (error) { note(error.message, true); }
};
$('#cancel').onclick = closeModal;
$('#modalForm').onsubmit = async event => {
  event.preventDefault();
  const action = modalAction;
  const value = $('#modalInput').value.trim();
  closeModal();
  try { await action(value); }
  catch (error) { note(error.message, true); }
};
refresh();
