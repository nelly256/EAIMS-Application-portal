(function () {
  'use strict';

  const form = document.getElementById('verifyForm');
  if (!form) return;

  const formError = document.getElementById('formError');
  const formSuccess = document.getElementById('formSuccess');
  const deliveryInfo = document.getElementById('deliveryInfo');
  const codeInput = document.getElementById('code');
  const submitButton = form.querySelector('button[type="submit"]');
  const resendButton = document.getElementById('resendVerification');

  const params = new URLSearchParams(window.location.search);
  if (params.get('delivery') === 'unavailable') {
    window.EaimsAuth.showFormMessage(formSuccess, 'Account created, but email or SMS delivery is not configured. Contact EAIMS support if you do not receive a code.', 'warning');
  }

  function getStoredDeliveryInfo() {
    try {
      const raw = window.sessionStorage.getItem('eaimsDeliveryInfo');
      return raw ? JSON.parse(raw) : null;
    } catch (error) {
      return null;
    }
  }

  function storeDeliveryInfo(delivery) {
    try {
      window.sessionStorage.setItem('eaimsDeliveryInfo', JSON.stringify(delivery || {}));
    } catch (error) {}
  }

  function clearStoredDeliveryInfo() {
    try {
      window.sessionStorage.removeItem('eaimsDeliveryInfo');
    } catch (error) {}
  }

  function describeDelivery(delivery) {
    if (!delivery) return null;
    const channels = [];
    if (delivery.email && delivery.email.sent) channels.push('email');
    if (delivery.sms && delivery.sms.sent) channels.push('SMS');
    const failures = [];
    if (delivery.email && !delivery.email.sent) failures.push(`email (${delivery.email.reason || 'failed'})`);
    if (delivery.sms && !delivery.sms.sent) failures.push(`SMS (${delivery.sms.reason || 'failed'})`);
    if (channels.length === 0 && failures.length === 0) return null;
    let summary = '';
    if (channels.length > 0) {
      summary = `The verification code has been sent to your ${channels.join(' and ')}.`;
    }
    if (failures.length > 0) {
      summary += ` ${failures.length > 0 ? 'Note: ' : ''}${failures.join(', ')} could not be delivered.`;
    }
    return summary;
  }

  function showDeliverySummary(delivery) {
    if (!deliveryInfo) return;
    const summary = describeDelivery(delivery);
    if (summary) {
      deliveryInfo.textContent = summary;
      deliveryInfo.hidden = false;
    } else {
      deliveryInfo.hidden = true;
    }
  }

  showDeliverySummary(getStoredDeliveryInfo());

  codeInput.addEventListener('input', () => {
    codeInput.value = codeInput.value.replace(/\D/g, '').slice(0, 6);
  });

  async function resend() {
    window.EaimsAuth.showFormMessage(formError, '');
    window.EaimsAuth.showFormMessage(formSuccess, '');
    resendButton.disabled = true;
    try {
      const payload = await window.EaimsAuth.request('/api/auth/resend-verification', { method: 'POST' });
      window.EaimsAuth.showFormMessage(formSuccess, payload.data.message);
      storeDeliveryInfo(payload.data.delivery);
      showDeliverySummary(payload.data.delivery);
    } catch (error) {
      window.EaimsAuth.showFormMessage(formError, error.message);
    } finally {
      resendButton.disabled = false;
    }
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    window.EaimsAuth.clearFieldErrors(form);
    window.EaimsAuth.showFormMessage(formError, '');
    window.EaimsAuth.showFormMessage(formSuccess, '');
    const errors = {};
    if (!/^\d{6}$/.test(codeInput.value)) errors.code = 'Enter the 6-digit verification code.';
    if (Object.keys(errors).length) {
      window.EaimsAuth.showFieldErrors(form, errors);
      return;
    }
    window.EaimsAuth.setLoading(submitButton, 'Verifying...');
    try {
      const payload = await window.EaimsAuth.request('/api/auth/verify', {
        method: 'POST',
        body: JSON.stringify({ code: codeInput.value }),
      });
      window.EaimsAuth.showFormMessage(formSuccess, payload.data.message);
      clearStoredDeliveryInfo();
      window.location.assign(payload.data.redirect);
    } catch (error) {
      window.EaimsAuth.showFieldErrors(form, error.fields);
      window.EaimsAuth.showFormMessage(formError, error.message);
    } finally {
      window.EaimsAuth.setLoading(submitButton, 'Verifying...', false);
    }
  });

  resendButton?.addEventListener('click', resend);
}());
