(function () {
  'use strict';

  let csrfToken = null;

  async function getCsrfToken() {
    if (csrfToken) return csrfToken;
    const response = await fetch('/api/auth/csrf', {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.data || !payload.data.token) {
      throw new Error('Unable to prepare a secure form session. Refresh the page and try again.');
    }
    csrfToken = payload.data.token;
    return csrfToken;
  }

  function clearCsrfToken() {
    csrfToken = null;
  }

  async function request(path, options = {}) {
    const method = String(options.method || 'GET').toUpperCase();
    const headers = new Headers(options.headers || {});
    headers.set('Accept', 'application/json');
    if (options.body && !(options.body instanceof FormData)) {
      headers.set('Content-Type', 'application/json');
    }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      headers.set('X-CSRF-Token', await getCsrfToken());
    }
    const response = await fetch(path, {
      ...options,
      method,
      headers,
      credentials: 'same-origin',
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.error?.message || 'The request could not be completed. Please try again.');
      error.status = response.status;
      error.code = payload.error?.code;
      error.fields = payload.error?.fields || {};
      throw error;
    }
    return payload;
  }

  function clearFieldErrors(form) {
    form.querySelectorAll('.field-error').forEach((element) => element.remove());
    form.querySelectorAll('[aria-invalid="true"]').forEach((element) => element.removeAttribute('aria-invalid'));
  }

  function showFieldErrors(form, fields = {}) {
    clearFieldErrors(form);
    Object.entries(fields).forEach(([name, message]) => {
      const field = form.querySelector(`[name="${CSS.escape(name)}"]`)?.closest('.field');
      if (!field) return;
      const error = document.createElement('p');
      error.className = 'field-error';
      error.setAttribute('role', 'alert');
      error.textContent = message;
      field.appendChild(error);
      const input = field.querySelector('input, select, textarea');
      if (input) input.setAttribute('aria-invalid', 'true');
    });
  }

  function showFormMessage(element, message, type = 'error') {
    if (!element) return;
    element.textContent = message || '';
    element.hidden = !message;
    element.className = `form-message form-message-${type}`;
  }

  function setLoading(button, loadingText, loading = true) {
    if (!button) return;
    if (loading) {
      button.dataset.originalText = button.textContent;
      button.textContent = loadingText || 'Please wait...';
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
    } else {
      button.textContent = button.dataset.originalText || button.textContent;
      button.disabled = false;
      button.removeAttribute('aria-busy');
    }
  }

  function initNavigation() {
    const toggle = document.getElementById('navToggle');
    const nav = document.getElementById('nav');
    if (!toggle || !nav) return;
    toggle.addEventListener('click', () => nav.classList.toggle('open'));
    document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
      anchor.addEventListener('click', () => nav.classList.remove('open'));
    });
  }

  function initPasswordToggles(root = document) {
    root.querySelectorAll('.password-toggle').forEach((button) => {
      button.addEventListener('click', () => {
        const input = root.querySelector(`#${CSS.escape(button.getAttribute('aria-controls'))}`);
        if (!input) return;
        const show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        button.setAttribute('aria-pressed', String(show));
        button.querySelector('.icon-eye').hidden = show;
        button.querySelector('.icon-eye-off').hidden = !show;
        button.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
      });
    });
  }

  function initDateLimits(root = document) {
    root.querySelectorAll('input[type="date"]').forEach((input) => {
      if (!input.min) input.min = '1900-01-01';
      if (!input.max) {
        const maximum = new Date();
        const year = maximum.getUTCFullYear() - 16;
        const month = maximum.getUTCMonth();
        const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
        const day = Math.min(maximum.getUTCDate(), daysInMonth);
        input.max = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      }
    });
  }

  window.EaimsAuth = {
    request,
    getCsrfToken,
    clearCsrfToken,
    clearFieldErrors,
    showFieldErrors,
    showFormMessage,
    setLoading,
    initNavigation,
    initPasswordToggles,
    initDateLimits,
  };
}());
