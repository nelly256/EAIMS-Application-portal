(function () {
  'use strict';

  const form = document.getElementById('registerForm');
  if (!form) return;

  const formError = document.getElementById('formError');
  const formSuccess = document.getElementById('formSuccess');
  const countrySelect = document.getElementById('phoneCountryCode');
  const nationalitySelect = document.getElementById('nationality');
  const phoneInput = document.getElementById('phoneNumber');
  const passwordInput = document.getElementById('password');
  const confirmPasswordInput = document.getElementById('confirmPassword');
  const submitButton = form.querySelector('button[type="submit"]');

  window.EaimsAuth.initDateLimits(form);
  window.EaimsAuth.initPasswordToggles(form);

  fetch('/api/auth/options', { headers: { Accept: 'application/json' } })
    .then((response) => response.json())
    .then((payload) => {
      if (!payload.ok) return;
      const selectedCountry = countrySelect.value || '+256';
      countrySelect.innerHTML = payload.data.countries
        .map((country) => `<option value="${country.code}">${country.name} (${country.code})</option>`)
        .join('');
      countrySelect.value = selectedCountry;
      const selectedNationality = nationalitySelect.value;
      nationalitySelect.innerHTML = '<option value="">Select nationality</option>' + payload.data.nationalities
        .map((nationality) => `<option value="${nationality}">${nationality}</option>`)
        .join('');
      nationalitySelect.value = selectedNationality;
    })
    .catch(() => {});

  phoneInput.addEventListener('input', () => {
    phoneInput.value = phoneInput.value.replace(/\D/g, '').slice(0, 15);
  });

  function clientErrors() {
    const errors = {};
    const data = new FormData(form);
    const surname = String(data.get('surname') || '').trim();
    const otherNames = String(data.get('otherNames') || '').trim();
    const email = String(data.get('email') || '').trim();
    const phone = String(data.get('phoneNumber') || '').trim();
    const nationality = String(data.get('nationality') || '');
    const dateOfBirth = String(data.get('dateOfBirth') || '');
    const sex = form.querySelector('input[name="sex"]:checked')?.value || '';
    const password = String(data.get('password') || '');
    const confirmPassword = String(data.get('confirmPassword') || '');
    if (surname.length < 2) errors.surname = 'Enter your surname.';
    if (otherNames.length < 2) errors.otherNames = 'Enter your other names.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = 'Enter a valid email address.';
    if (phone.replace(/\D/g, '').length < 7) errors.phoneNumber = 'Enter a valid phone number.';
    if (!nationality) errors.nationality = 'Select your nationality.';
    if (!dateOfBirth) errors.dateOfBirth = 'Select your date of birth.';
    if (!sex) errors.sex = 'Select your sex.';
    if (password.length < 8) errors.password = 'Password must be at least 8 characters.';
    if (confirmPassword !== password) errors.confirmPassword = 'Passwords do not match.';
    return errors;
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    window.EaimsAuth.clearFieldErrors(form);
    window.EaimsAuth.showFormMessage(formError, '');
    window.EaimsAuth.showFormMessage(formSuccess, '');
    const errors = clientErrors();
    if (Object.keys(errors).length) {
      window.EaimsAuth.showFieldErrors(form, errors);
      window.EaimsAuth.showFormMessage(formError, 'Check the highlighted fields and try again.');
      return;
    }
    const data = Object.fromEntries(new FormData(form).entries());
    data.phoneCountryCode = countrySelect.value;
    data.sex = form.querySelector('input[name="sex"]:checked')?.value || '';
    window.EaimsAuth.setLoading(submitButton, 'Creating account...');
    try {
      const payload = await window.EaimsAuth.request('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify(data),
      });
      try {
        window.sessionStorage.setItem('eaimsDeliveryInfo', JSON.stringify(payload.data.delivery || {}));
      } catch (error) {}
      if (!payload.data.deliveryAvailable) {
        window.location.assign('/verify.html?delivery=unavailable');
        return;
      }
      window.location.assign(payload.data.redirect);
    } catch (error) {
      window.EaimsAuth.showFieldErrors(form, error.fields);
      window.EaimsAuth.showFormMessage(formError, error.message);
      if (error.code === 'ACCOUNT_EXISTS') {
        window.EaimsAuth.showFormMessage(formSuccess, 'Use the login or password recovery option for an existing account.', 'warning');
      }
    } finally {
      window.EaimsAuth.setLoading(submitButton, 'Creating account...', false);
    }
  });
}());
