'use strict';

(() => {
  const form = document.getElementById('support-login-form');
  const messageNode = document.getElementById('support-login-message');
  let csrfToken = '';

  async function loadCsrfToken() {
    const response = await fetch('/api/support/csrf');
    const payload = await response.json();
    if (!response.ok || !payload.ok) throw new Error('Unable to start a secure sign-in session.');
    csrfToken = payload.data.token;
  }

  loadCsrfToken().catch((error) => {
    messageNode.textContent = error.message;
    messageNode.classList.add('is-error');
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    messageNode.textContent = '';
    messageNode.classList.remove('is-error');
    try {
      if (!csrfToken) await loadCsrfToken();
      const response = await fetch('/api/support/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
        body: JSON.stringify({
          email: form.elements.email.value,
          password: form.elements.password.value,
        }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error?.message || 'Sign-in failed.');
      window.location.assign('/support/inbox');
    } catch (error) {
      messageNode.textContent = error.message;
      messageNode.classList.add('is-error');
    } finally {
      submit.disabled = false;
    }
  });
})();
