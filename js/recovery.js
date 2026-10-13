(function () {
  'use strict';

  const form = document.getElementById('recoveryForm');
  if (!form) return;

  const formError = document.getElementById('formError');
  const formSuccess = document.getElementById('formSuccess');
  const submitButton = form.querySelector('button[type="submit"]');
  window.EaimsAuth.initPasswordToggles(form);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    window.EaimsAuth.clearFieldErrors(form);
    window.EaimsAuth.showFormMessage(formError, '');
    window.EaimsAuth.showFormMessage(formSuccess, '');
    const identifier = String(new FormData(form).get('identifier') || '').trim();
    const errors = {};
    if (!identifier) errors.identifier = 'Enter your registered email address or phone number.';
    if (Object.keys(errors).length) {
      window.EaimsAuth.showFieldErrors(form, errors);
      return;
    }
    window.EaimsAuth.setLoading(submitButton, 'Sending instructions...');
    try {
      const payload = await window.EaimsAuth.request('/api/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ identifier }),
      });
      const message = payload.data.developmentResetUrl
        ? `${payload.data.message} Development reset link: ${payload.data.developmentResetUrl}`
        : payload.data.message;
      window.EaimsAuth.showFormMessage(formSuccess, message);
      form.reset();
    } catch (error) {
      window.EaimsAuth.showFieldErrors(form, error.fields);
      window.EaimsAuth.showFormMessage(formError, error.message);
    } finally {
      window.EaimsAuth.setLoading(submitButton, 'Sending instructions...', false);
    }
  });
}());
