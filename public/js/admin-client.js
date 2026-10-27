'use strict';

(function () {
  let csrfToken = null;

  async function getCsrfToken() {
    if (csrfToken) return csrfToken;
    const response = await fetch('/api/admin/csrf', {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.data?.token) {
      throw new Error('Unable to prepare a secure staff session. Refresh the page and try again.');
    }
    csrfToken = payload.data.token;
    return csrfToken;
  }

  async function request(path, options = {}) {
    const method = String(options.method || 'GET').toUpperCase();
    const headers = new Headers(options.headers || {});
    headers.set('Accept', 'application/json');
    if (options.body && !(options.body instanceof FormData)) headers.set('Content-Type', 'application/json');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) headers.set('X-CSRF-Token', await getCsrfToken());
    const response = await fetch(path, {
      ...options,
      method,
      headers,
      credentials: 'same-origin',
      cache: 'no-store',
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.error?.message || 'The request could not be completed.');
      error.status = response.status;
      error.code = payload.error?.code;
      throw error;
    }
    if (payload.data?.csrfToken) csrfToken = payload.data.csrfToken;
    return payload;
  }

  async function download(path) {
    const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store' });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error?.message || 'The report could not be downloaded.');
    }
    const blob = await response.blob();
    const disposition = response.headers.get('Content-Disposition') || '';
    const filename = disposition.match(/filename="([^"]+)"/)?.[1] || 'eaims-report.csv';
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  window.EaimsAdmin = { request, download, getCsrfToken };
}());
