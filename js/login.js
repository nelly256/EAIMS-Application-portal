(function () {
  'use strict';

  const form = document.getElementById('loginForm');
  if (!form) return;

  const formError = document.getElementById('formError');
  const formSuccess = document.getElementById('formSuccess');
  const submitButton = form.querySelector('button[type="submit"]');
  const params = new URLSearchParams(window.location.search);
  if (params.get('verified') === '1') {
    window.EaimsAuth.showFormMessage(formSuccess, 'Your account has been verified. Log in to continue.');
  }
  if (params.get('reset') === '1') {
    window.EaimsAuth.showFormMessage(formSuccess, 'Your password has been updated. Log in with your new password.');
  }
  window.EaimsAuth.initPasswordToggles(form);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    window.EaimsAuth.clearFieldErrors(form);
    window.EaimsAuth.showFormMessage(formError, '');
    window.EaimsAuth.showFormMessage(formSuccess, '');
    const data = Object.fromEntries(new FormData(form).entries());
    const errors = {};
    if (!String(data.identifier || '').trim()) errors.identifier = 'Enter your email or phone number.';
    if (!String(data.password || '')) errors.password = 'Enter your password.';
    if (Object.keys(errors).length) {
      window.EaimsAuth.showFieldErrors(form, errors);
      return;
    }
    window.EaimsAuth.setLoading(submitButton, 'Logging in...');
    try {
      const payload = await window.EaimsAuth.request('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify(data),
      });
      window.EaimsAuth.clearCsrfToken();
      window.location.assign(payload.data.redirect);
    } catch (error) {
      window.EaimsAuth.showFieldErrors(form, error.fields);
      window.EaimsAuth.showFormMessage(formError, error.message);
      if (error.code === 'VERIFICATION_REQUIRED') window.location.assign('/verify.html');
    } finally {
      window.EaimsAuth.setLoading(submitButton, 'Logging in...', false);
    }
  });
}());
