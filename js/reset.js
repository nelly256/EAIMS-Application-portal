(function () {
  'use strict';

  const form = document.getElementById('resetForm');
  if (!form) return;

  const token = new URLSearchParams(window.location.search).get('token') || '';
  const formError = document.getElementById('formError');
  const formSuccess = document.getElementById('formSuccess');
  const submitButton = form.querySelector('button[type="submit"]');
  const passwordInput = document.getElementById('password');
  const confirmPasswordInput = document.getElementById('confirmPassword');
  window.EaimsAuth.initPasswordToggles(form);

  if (!token) {
    window.EaimsAuth.showFormMessage(formError, 'This password reset link is missing its secure token.');
    submitButton.disabled = true;
    return;
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    window.EaimsAuth.clearFieldErrors(form);
    window.EaimsAuth.showFormMessage(formError, '');
    window.EaimsAuth.showFormMessage(formSuccess, '');
    const errors = {};
    if (passwordInput.value.length < 8) errors.password = 'Password must be at least 8 characters.';
    if (confirmPasswordInput.value !== passwordInput.value) errors.confirmPassword = 'Passwords do not match.';
    if (Object.keys(errors).length) {
      window.EaimsAuth.showFieldErrors(form, errors);
      return;
    }
    window.EaimsAuth.setLoading(submitButton, 'Updating password...');
    try {
      const payload = await window.EaimsAuth.request('/api/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ token, password: passwordInput.value, confirmPassword: confirmPasswordInput.value }),
      });
      window.EaimsAuth.showFormMessage(formSuccess, payload.data.message);
      window.location.assign(payload.data.redirect);
    } catch (error) {
      window.EaimsAuth.showFieldErrors(form, error.fields);
      window.EaimsAuth.showFormMessage(formError, error.message);
    } finally {
      window.EaimsAuth.setLoading(submitButton, 'Updating password...', false);
    }
  });
}());
