(function () {
  'use strict';

  const form = document.getElementById('verifyForm');
  if (!form) return;

  const formError = document.getElementById('formError');
  const formSuccess = document.getElementById('formSuccess');
  const applicationNumberInfo = document.getElementById('applicationNumberInfo');
  const deliveryInfo = document.getElementById('deliveryInfo');
  const codeInput = document.getElementById('code');
  const submitButton = form.querySelector('button[type="submit"]');
  const resendButton = document.getElementById('resendVerification');

  const params = new URLSearchParams(window.location.search);
  if (params.get('delivery') === 'unavailable') {
    window.EaimsAuth.showFormMessage(formSuccess, 'Your account was created. If you do not receive a verification code, contact EAIMS support.', 'warning');
  }

  function getStoredDeliveryInfo() {
    try {
      const raw = window.sessionStorage.getItem('eaimsDeliveryInfo');
      if (!raw) return null;
      const delivery = JSON.parse(raw);
      const safeDelivery = {
        email: { sent: Boolean(delivery.email && delivery.email.sent) },
        sms: { sent: Boolean(delivery.sms && delivery.sms.sent) },
      };
      window.sessionStorage.setItem('eaimsDeliveryInfo', JSON.stringify(safeDelivery));
      return safeDelivery;
    } catch (error) {
      return null;
    }
  }

  function storeDeliveryInfo(delivery) {
    try {
      const safeDelivery = {
        email: { sent: Boolean(delivery && delivery.email && delivery.email.sent) },
        sms: { sent: Boolean(delivery && delivery.sms && delivery.sms.sent) },
      };
      window.sessionStorage.setItem('eaimsDeliveryInfo', JSON.stringify(safeDelivery));
    } catch (error) {}
  }

  function clearStoredDeliveryInfo() {
    try {
      window.sessionStorage.removeItem('eaimsDeliveryInfo');
      window.sessionStorage.removeItem('eaimsApplicationNumber');
    } catch (error) {}
  }

  try {
    const applicationNumber = window.sessionStorage.getItem('eaimsApplicationNumber');
    if (applicationNumber) {
      applicationNumberInfo.textContent = `Your application number is ${applicationNumber}. Keep it for future reference.`;
      applicationNumberInfo.hidden = false;
    }
  } catch (error) {}

  function describeDelivery(delivery) {
    if (!delivery) return null;
    const channels = [];
    if (delivery.email && delivery.email.sent) channels.push('email');
    if (delivery.sms && delivery.sms.sent) channels.push('SMS');
    const failures = [];
    if (delivery.email && !delivery.email.sent) failures.push('email');
    if (delivery.sms && !delivery.sms.sent) failures.push('SMS');
    if (channels.length === 0 && failures.length === 0) return null;
    let summary = '';
    if (channels.length > 0) {
      summary = `The verification code has been sent to your ${channels.join(' and ')}.`;
    }
    if (failures.length > 0) {
      summary += channels.length > 0
        ? ' It could not be sent to all of your contact methods.'
        : ' We could not send a verification code. Please contact support if you need help.';
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
