'use strict';

(function () {
  const form = document.getElementById('adminLoginForm');
  const message = document.getElementById('adminLoginMessage');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    message.hidden = true;
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      const data = Object.fromEntries(new FormData(form));
      const result = await window.EaimsAdmin.request('/api/admin/login', {
        method: 'POST',
        body: JSON.stringify(data),
      });
      window.location.assign(result.data.redirect);
    } catch (error) {
      message.textContent = error.message;
      message.hidden = false;
      button.disabled = false;
    }
  });
}());
