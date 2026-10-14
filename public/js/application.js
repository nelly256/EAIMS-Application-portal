'use strict';

(function () {
  const form = document.getElementById('applicationProfileForm');
  if (!form) return;

  const logoutButton = document.getElementById('logoutButton');
  const errorMessage = document.getElementById('applicationError');
  const successMessage = document.getElementById('applicationSuccess');
  const saveState = document.getElementById('saveState');
  const countrySelect = document.getElementById('countryOfBirth');
  const photoInput = document.getElementById('passportPhoto');
  const photoDropzone = document.querySelector('.photo-dropzone');
  const photoPreview = document.getElementById('passportPhotoPreview');
  const progressTag = document.getElementById('applicationProgressTag');
  const saveTimers = new Map();
  let pendingSaves = 0;
  let hasPassportPhoto = false;

  window.EaimsAuth.initDateLimits(form);

  function setSaveState(text, state = 'saved') {
    saveState.textContent = text;
    saveState.dataset.state = state;
  }

  function showApplicationError(message) {
    window.EaimsAuth.showFormMessage(errorMessage, message);
  }

  function clearApplicationError() {
    window.EaimsAuth.showFormMessage(errorMessage, '');
  }

  logoutButton?.addEventListener('click', async () => {
    logoutButton.disabled = true;
    try {
      const payload = await window.EaimsAuth.request('/api/auth/logout', { method: 'POST' });
      window.EaimsAuth.clearCsrfToken();
      window.location.assign(payload.data.redirect);
    } catch (error) {
      showApplicationError(error.message);
      logoutButton.disabled = false;
    }
  });

  function showProfilePhoto(source) {
    photoPreview.replaceChildren();
    const image = document.createElement('img');
    image.alt = 'Passport photo preview';
    image.src = source;
    photoPreview.appendChild(image);
  }

  function setFieldValue(name, value) {
    if (name === 'gender') {
      const radio = form.querySelector(`input[name="gender"][value="${CSS.escape(value || '')}"]`);
      if (radio) radio.checked = true;
      return;
    }
    const input = form.elements.namedItem(name);
    if (input && input.type !== 'file') input.value = value || '';
  }

  function updateProfileStatus() {
    const values = [
      form.elements.namedItem('firstName').value,
      form.elements.namedItem('lastName').value,
      form.elements.namedItem('idNumber').value,
      form.elements.namedItem('countryOfBirth').value,
      form.elements.namedItem('dateOfBirth').value,
      form.querySelector('input[name="gender"]:checked')?.value,
      form.elements.namedItem('physicalAddress').value,
      hasPassportPhoto,
    ];
    const completed = values.filter((value) => String(value || '').trim()).length;
    const state = completed === values.length ? 'complete' : completed ? 'in-progress' : 'not-started';
    progressTag.className = `application-progress-tag is-${state}`;
    progressTag.lastChild.textContent = state === 'complete' ? 'Complete' : state === 'in-progress' ? 'In Progress' : 'Not Started';
  }

  async function loadApplicationProfile() {
    try {
      const payload = await window.EaimsAuth.request('/api/application/profile');
      const profile = payload.data.profile;
      countrySelect.innerHTML = '<option value="">Select your country</option>' + payload.data.countries
        .map((country) => `<option value="${country}">${country}</option>`)
        .join('');
      for (const field of ['firstName', 'lastName', 'idNumber', 'countryOfBirth', 'dateOfBirth', 'gender', 'physicalAddress', 'email', 'phone']) {
        setFieldValue(field, profile[field]);
      }
      hasPassportPhoto = Boolean(profile.hasPassportPhoto);
      if (hasPassportPhoto) showProfilePhoto(`/api/application/profile/photo?updated=${Date.now()}`);
      updateProfileStatus();
      setSaveState('All changes saved');
    } catch (error) {
      if (error.status === 401 || error.status === 403) {
        window.location.assign('/login.html');
        return;
      }
      showApplicationError(error.message);
      setSaveState('Unable to load saved details', 'error');
    }
  }

  async function saveField(field) {
    const input = field === 'gender'
      ? form.querySelector('input[name="gender"]:checked')
      : form.elements.namedItem(field);
    if (!input) return;
    const value = field === 'gender' ? input.value : input.value.trim();
    const errorElement = form.querySelector(`[data-error-for="${CSS.escape(field)}"]`);
    if (errorElement) {
      errorElement.hidden = true;
      errorElement.textContent = '';
    }
    if (input.removeAttribute) input.removeAttribute('aria-invalid');

    pendingSaves += 1;
    setSaveState('Saving changes...', 'saving');
    try {
      await window.EaimsAuth.request('/api/application/profile', {
        method: 'PATCH',
        body: JSON.stringify({ [field]: value }),
      });
      updateProfileStatus();
      if (errorElement) errorElement.hidden = true;
      clearApplicationError();
      setSaveState('All changes saved');
    } catch (error) {
      if (error.status === 401 || error.status === 403) {
        window.location.assign('/login.html');
        return;
      }
      const fieldError = error.fields && error.fields[field];
      if (fieldError && errorElement) {
        errorElement.textContent = fieldError;
        errorElement.hidden = false;
        input.setAttribute('aria-invalid', 'true');
      } else {
        showApplicationError(error.message);
      }
      setSaveState('Changes could not be saved', 'error');
    } finally {
      pendingSaves = Math.max(0, pendingSaves - 1);
      if (pendingSaves && saveState.dataset.state !== 'error') setSaveState('Saving changes...', 'saving');
    }
  }

  function scheduleSave(field, immediate = false) {
    const existing = saveTimers.get(field);
    if (existing) clearTimeout(existing);
    if (immediate) {
      saveTimers.delete(field);
      saveField(field);
      return;
    }
    saveTimers.set(field, setTimeout(() => {
      saveTimers.delete(field);
      saveField(field);
    }, 500));
  }

  for (const field of ['firstName', 'lastName', 'idNumber', 'physicalAddress']) {
    const input = form.elements.namedItem(field);
    input.addEventListener('input', () => scheduleSave(field));
    input.addEventListener('blur', () => scheduleSave(field, true));
  }

  for (const field of ['countryOfBirth', 'dateOfBirth']) {
    form.elements.namedItem(field).addEventListener('change', () => scheduleSave(field, true));
  }
  form.querySelectorAll('input[name="gender"]').forEach((input) => {
    input.addEventListener('change', () => scheduleSave('gender', true));
  });

  async function uploadPhoto(file) {
    clearApplicationError();
    const errorElement = form.querySelector('[data-error-for="passportPhoto"]');
    errorElement.hidden = true;
    if (!file) return;
    if (!['image/jpeg', 'image/png'].includes(file.type) || file.size > 5 * 1024 * 1024) {
      errorElement.textContent = file.size > 5 * 1024 * 1024
        ? 'Choose a photo smaller than 5 MB.'
        : 'Upload a JPEG or PNG image.';
      errorElement.hidden = false;
      return;
    }
    const reader = new FileReader();
    reader.addEventListener('load', () => showProfilePhoto(String(reader.result)));
    reader.readAsDataURL(file);
    setSaveState('Uploading photo...', 'saving');
    try {
      const response = await fetch('/api/application/profile/photo', {
        method: 'PUT',
        credentials: 'same-origin',
        headers: {
          Accept: 'application/json',
          'Content-Type': file.type,
          'X-CSRF-Token': await window.EaimsAuth.getCsrfToken(),
        },
        body: file,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(payload.error?.message || 'The photo could not be uploaded.');
        error.status = response.status;
        error.fields = payload.error?.fields || {};
        throw error;
      }
      hasPassportPhoto = true;
      showProfilePhoto(`/api/application/profile/photo?updated=${Date.now()}`);
      updateProfileStatus();
      setSaveState('All changes saved');
    } catch (error) {
      if (error.status === 401 || error.status === 403) {
        window.location.assign('/login.html');
        return;
      }
      errorElement.textContent = error.fields?.passportPhoto || error.message;
      errorElement.hidden = false;
      setSaveState('Photo could not be saved', 'error');
    }
  }

  photoInput.addEventListener('change', () => uploadPhoto(photoInput.files[0]));
  photoDropzone.addEventListener('dragover', (event) => {
    event.preventDefault();
    photoDropzone.classList.add('is-dragging');
  });
  photoDropzone.addEventListener('dragleave', () => photoDropzone.classList.remove('is-dragging'));
  photoDropzone.addEventListener('drop', (event) => {
    event.preventDefault();
    photoDropzone.classList.remove('is-dragging');
    uploadPhoto(event.dataTransfer.files[0]);
  });

  loadApplicationProfile();
}());
