(() => {
  const originalFetch = window.fetch.bind(window);
  let clickedButton = null;
  let activeRequests = 0;

  const region = document.createElement('div');
  region.id = 'operationStatus';
  region.className = 'operation-status hidden';
  region.setAttribute('role', 'status');
  region.setAttribute('aria-live', 'polite');
  region.innerHTML = '<span class="operation-spinner" aria-hidden="true"></span><span class="operation-message">Working…</span>';
  document.body.appendChild(region);

  const message = region.querySelector('.operation-message');
  const originalLabels = new WeakMap();

  function labelFor(button) {
    const text = button?.dataset?.workingLabel;
    if (text) return text;
    const source = (button?.textContent || '').trim().toLowerCase();
    if (source.includes('sync')) return 'Synchronizing accounts…';
    if (source.includes('recover')) return 'Recovering transaction history…';
    if (source.includes('history')) return 'Checking transaction history…';
    if (source.includes('refresh')) return 'Refreshing data…';
    if (source.includes('approve')) return 'Approving the initial import…';
    if (source.includes('rename')) return 'Renaming the Actual account…';
    if (source.includes('archive')) return 'Updating dashboard organization…';
    if (source.includes('remove')) return 'Removing selected test accounts…';
    return 'Saving changes…';
  }

  function begin(button) {
    activeRequests += 1;
    region.classList.remove('hidden', 'success', 'error');
    message.textContent = labelFor(button);
    document.body.classList.add('operation-active');
    if (!button) return;
    originalLabels.set(button, button.innerHTML);
    button.disabled = true;
    button.classList.add('is-loading');
    button.setAttribute('aria-busy', 'true');
    button.innerHTML = '<span class="button-spinner" aria-hidden="true"></span><span>Working…</span>';
  }

  function finish(button, ok) {
    activeRequests = Math.max(0, activeRequests - 1);
    if (button && originalLabels.has(button)) {
      button.innerHTML = originalLabels.get(button);
      button.disabled = false;
      button.classList.remove('is-loading');
      button.removeAttribute('aria-busy');
      originalLabels.delete(button);
    }
    if (activeRequests > 0) return;
    document.body.classList.remove('operation-active');
    region.classList.add(ok ? 'success' : 'error');
    message.textContent = ok ? 'Operation completed successfully.' : 'The operation failed. Review the error message for details.';
    window.setTimeout(() => region.classList.add('hidden'), ok ? 3500 : 8000);
  }

  document.addEventListener('pointerdown', event => {
    const button = event.target.closest('button');
    if (button && !button.disabled) clickedButton = button;
  }, true);

  document.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button || button.disabled) return;
    button.classList.add('was-pressed');
    window.setTimeout(() => button.classList.remove('was-pressed'), 180);
  }, true);

  window.fetch = async (...args) => {
    const button = clickedButton;
    clickedButton = null;
    begin(button);
    try {
      const response = await originalFetch(...args);
      finish(button, response.ok);
      return response;
    } catch (error) {
      finish(button, false);
      throw error;
    }
  };
})();