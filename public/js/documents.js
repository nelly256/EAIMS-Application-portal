'use strict';

(function () {
  const fileInput = document.getElementById('documentInput');
  const dropzone = document.getElementById('documentDropzone');
  const documentsList = document.getElementById('documentsList');
  const errorMessage = document.getElementById('documentsError');
  const statusMessage = document.getElementById('documentsStatus');
  const logoutButton = document.getElementById('logoutButton');
  const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png'];
  const maxBytes = 10 * 1024 * 1024;

  function showError(message) {
    errorMessage.textContent = message || '';
    errorMessage.hidden = !message;
  }

  function showStatus(message) {
    statusMessage.textContent = message || '';
    statusMessage.hidden = !message;
  }

  function formatSize(bytes) {
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function renderDocuments(documents) {
    documentsList.replaceChildren();
    if (!documents.length) {
      const empty = document.createElement('div');
      empty.className = 'documents-empty-state';
      const icon = document.createElement('i');
      icon.className = 'fas fa-folder-open';
      icon.setAttribute('aria-hidden', 'true');
      const title = document.createElement('h3');
      title.textContent = 'No Documents Yet';
      const message = document.createElement('p');
      message.textContent = "You haven't uploaded any documents for your application.";
      const uploadButton = document.createElement('button');
      uploadButton.type = 'button';
      uploadButton.className = 'documents-upload-button';
      uploadButton.innerHTML = '<i class="fas fa-cloud-arrow-up" aria-hidden="true"></i> Upload Documents';
      uploadButton.addEventListener('click', () => fileInput.click());
      empty.append(icon, title, message, uploadButton);
      documentsList.appendChild(empty);
      return;
    }

    const list = document.createElement('ul');
    list.className = 'documents-file-list';
    documents.forEach((documentItem) => {
      const row = document.createElement('li');
      row.className = 'documents-file-item';
      const icon = document.createElement('i');
      icon.className = `fas ${documentItem.mime_type === 'application/pdf' ? 'fa-file-pdf' : 'fa-file-image'}`;
      icon.setAttribute('aria-hidden', 'true');
      const details = document.createElement('div');
      details.className = 'documents-file-details';
      const name = document.createElement('strong');
      name.textContent = documentItem.filename;
      const meta = document.createElement('span');
      const date = new Date(`${documentItem.created_at.replace(' ', 'T')}Z`);
      meta.textContent = `${formatSize(documentItem.size)} · Uploaded ${Number.isNaN(date.getTime()) ? 'recently' : date.toLocaleDateString()}`;
      details.append(name, meta);

      const actions = document.createElement('div');
      actions.className = 'documents-file-actions';
      const download = document.createElement('button');
      download.type = 'button';
      download.className = 'documents-action-button';
      download.innerHTML = '<i class="fas fa-download" aria-hidden="true"></i><span>Download</span>';
      download.addEventListener('click', () => downloadDocument(documentItem));
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'documents-action-button is-danger';
      remove.innerHTML = '<i class="fas fa-trash" aria-hidden="true"></i><span>Remove</span>';
      remove.addEventListener('click', () => deleteDocument(documentItem, remove));
      actions.append(download, remove);
      row.append(icon, details, actions);
      list.appendChild(row);
    });
    documentsList.appendChild(list);
  }

  async function loadDocuments() {
    try {
      const payload = await window.EaimsAuth.request('/api/application/documents');
      renderDocuments(payload.data.documents);
    } catch (error) {
      if (error.status === 401 || error.status === 403) {
        window.location.assign('/login.html');
        return;
      }
      showError(error.message);
      documentsList.replaceChildren();
    }
  }

  async function uploadDocument(file) {
    showError('');
    showStatus('');
    if (!file) return;
    if (!allowedTypes.includes(file.type)) {
      showError('Choose a PDF, JPEG, or PNG document.');
      return;
    }
    if (file.size > maxBytes) {
      showError('Choose a document smaller than 10 MB.');
      return;
    }

    dropzone.disabled = true;
    dropzone.setAttribute('aria-busy', 'true');
    showStatus(`Uploading ${file.name}...`);
    try {
      const token = await window.EaimsAuth.getCsrfToken();
      const response = await fetch(`/api/application/documents?name=${encodeURIComponent(file.name)}`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          Accept: 'application/json',
          'Content-Type': file.type,
          'X-CSRF-Token': token,
        },
        body: file,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(payload.error?.message || 'The document could not be uploaded.');
        error.status = response.status;
        throw error;
      }
      showStatus('Document uploaded successfully.');
      await loadDocuments();
    } catch (error) {
      if (error.status === 401 || error.status === 403) {
        window.location.assign('/login.html');
        return;
      }
      showError(error.message);
      showStatus('');
    } finally {
      dropzone.disabled = false;
      dropzone.removeAttribute('aria-busy');
      fileInput.value = '';
    }
  }

  async function downloadDocument(documentItem) {
    showError('');
    try {
      const response = await fetch(`/api/application/documents/${documentItem.id}/file`, {
        credentials: 'same-origin',
        headers: { Accept: documentItem.mime_type },
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        const error = new Error(payload.error?.message || 'The document could not be downloaded.');
        error.status = response.status;
        throw error;
      }
      const objectUrl = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = documentItem.filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (error) {
      if (error.status === 401 || error.status === 403) {
        window.location.assign('/login.html');
        return;
      }
      showError(error.message);
    }
  }

  async function deleteDocument(documentItem, button) {
    if (!window.confirm(`Remove "${documentItem.filename}" from your documents?`)) return;
    button.disabled = true;
    showError('');
    try {
      await window.EaimsAuth.request(`/api/application/documents/${documentItem.id}`, { method: 'DELETE' });
      showStatus('Document removed.');
      await loadDocuments();
    } catch (error) {
      if (error.status === 401 || error.status === 403) {
        window.location.assign('/login.html');
        return;
      }
      showError(error.message);
      button.disabled = false;
    }
  }

  fileInput.addEventListener('change', () => uploadDocument(fileInput.files[0]));
  dropzone.addEventListener('click', () => fileInput.click());
  dropzone.addEventListener('dragover', (event) => {
    event.preventDefault();
    dropzone.classList.add('is-dragging');
  });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('is-dragging'));
  dropzone.addEventListener('drop', (event) => {
    event.preventDefault();
    dropzone.classList.remove('is-dragging');
    uploadDocument(event.dataTransfer.files[0]);
  });
  logoutButton?.addEventListener('click', async () => {
    logoutButton.disabled = true;
    try {
      const payload = await window.EaimsAuth.request('/api/auth/logout', { method: 'POST' });
      window.EaimsAuth.clearCsrfToken();
      window.location.assign(payload.data.redirect);
    } catch (error) {
      showError(error.message);
      logoutButton.disabled = false;
    }
  });

  window.EaimsAuth.request('/api/dashboard')
    .then((payload) => {
      const applicant = payload.data.applicant;
      const name = [applicant.otherNames, applicant.surname].filter(Boolean).join(' ') || 'Applicant';
      document.getElementById('headerApplicantName').textContent = name;
      document.getElementById('applicantInitials').textContent = name
        .split(/\s+/)
        .map((part) => part[0])
        .join('')
        .slice(0, 2)
        .toUpperCase();
    })
    .catch((error) => {
      if (error.status === 401 || error.status === 403) window.location.assign('/login.html');
      else showError(error.message);
    });

  loadDocuments();
}());
