'use strict';

(function () {
  const form = document.getElementById('applicationProfileForm');
  if (!form) return;

  const logoutButton = document.getElementById('logoutButton');
  const errorMessage = document.getElementById('applicationError');
  const successMessage = document.getElementById('applicationSuccess');
  const submissionStatusMessage = document.getElementById('applicationSubmissionStatus');
  const applicationReference = document.getElementById('applicationReference');
  const saveState = document.getElementById('saveState');
  const countrySelect = document.getElementById('countryOfBirth');
  const trainingArrangementsGroup = document.getElementById('trainingArrangementsGroup');
  const trainingArrangementInputs = Array.from(form.querySelectorAll('input[name="trainingArrangements"]'));
  const photoInput = document.getElementById('passportPhoto');
  const photoDropzone = document.querySelector('.photo-dropzone');
  const photoPreview = document.getElementById('passportPhotoPreview');
  const documentInputs = {
    transcript: document.getElementById('transcriptFiles'),
    identity: document.getElementById('identityFile'),
    additional: document.getElementById('additionalFiles'),
  };
  const documentLists = {
    transcript: document.getElementById('transcriptDocumentList'),
    identity: document.getElementById('identityDocumentList'),
    additional: document.getElementById('additionalDocumentList'),
  };
  const documentErrors = {
    transcript: document.getElementById('transcriptUploadError'),
    identity: document.getElementById('identityUploadError'),
    additional: document.getElementById('additionalUploadError'),
  };
  const progressTag = document.getElementById('applicationProgressTag');
  const personalInfoSection = document.getElementById('personalInfoSection');
  const programSelectionSection = document.getElementById('programSelectionSection');
  const documentUploadSection = document.getElementById('documentUploadSection');
  const programLevelCards = document.getElementById('programLevelCards');
  const programLevelButtons = Array.from(programLevelCards.querySelectorAll('[data-program-level]'));
  const programTableBody = document.getElementById('programTableBody');
  const programTableWrapper = document.getElementById('programCatalogTableWrapper');
  const intakeCards = document.getElementById('intakeCards');
  const programHelp = document.getElementById('programHelp');
  const programError = document.getElementById('programError');
  const programChoiceSummary = document.getElementById('programChoiceSummary');
  const programChoiceName = document.getElementById('programChoiceName');
  const programChoiceLevel = document.getElementById('programChoiceLevel');
  const programChoiceDuration = document.getElementById('programChoiceDuration');
  const programChoiceTuition = document.getElementById('programChoiceTuition');
  const programChoiceIntake = document.getElementById('programChoiceIntake');
  const programSelectionStatus = document.getElementById('programSelectionStatus');
  const documentUploadStatus = document.getElementById('documentUploadStatus');
  const nextStepHelp = document.getElementById('nextStepHelp');
  const continueProgramButton = document.getElementById('continueProgramButton');
  const backToPersonalButton = document.getElementById('backToPersonalButton');
  const saveProgramButton = document.getElementById('saveProgramButton');
  const continueDocumentsButton = document.getElementById('continueDocumentsButton');
  const backToProgramButton = document.getElementById('backToProgramButton');
  const submitApplicationButton = document.getElementById('submitApplicationButton');
  const stepper = document.getElementById('progress');
  const progressSteps = Array.from(document.querySelectorAll('#progress li'));
  const saveTimers = new Map();
  const saveChains = new Map();
  const queuedSaveFields = new Set();
  const dirtyFields = new Set();
  let pendingSaves = 0;
  let hasPassportPhoto = false;
  let applicationDocuments = [];
  let programs = [];
  let intakes = [];
  let selectedProgram = null;
  let activeProgramLevel = '';
  let pendingProgramId = '';
  let pendingIntake = '';
  let submissionLocked = false;
  let pendingUploads = 0;
  let currentStep = 1;
  const visitedSteps = new Set([1]);

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

  function formatFileSize(size) {
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  }

  function renderApplicationDocuments() {
    for (const [category, list] of Object.entries(documentLists)) {
      list.replaceChildren();
      applicationDocuments
        .filter((applicationDocument) => applicationDocument.category === category)
        .forEach((applicationDocument) => {
          const item = document.createElement('li');
          item.className = 'application-document-item';
          const details = document.createElement('div');
          const link = document.createElement('a');
          link.href = `/api/application/documents/${encodeURIComponent(applicationDocument.id)}`;
          link.download = applicationDocument.original_name;
          link.textContent = applicationDocument.original_name;
          const metadata = document.createElement('small');
          metadata.textContent = `${formatFileSize(applicationDocument.file_size)} · ${applicationDocument.mime_type}`;
          details.append(link, metadata);

          const removeButton = document.createElement('button');
          removeButton.className = 'application-document-remove';
          removeButton.type = 'button';
          removeButton.textContent = 'Remove';
          removeButton.setAttribute('aria-label', `Remove ${applicationDocument.original_name}`);
          removeButton.addEventListener('click', () => deleteApplicationDocument(applicationDocument));
          item.append(details, removeButton);
          list.appendChild(item);
        });
    }
  }

  async function uploadApplicationDocuments(category, fileList) {
    const input = documentInputs[category];
    const errorElement = documentErrors[category];
    const files = Array.from(fileList || []);
    if (!files.length) return;

    errorElement.hidden = true;
    errorElement.textContent = '';
    input.disabled = true;
    pendingUploads += 1;
    updateApplicationProgress();
    const failures = [];
    try {
      for (const file of files) {
        if (!['application/pdf', 'image/jpeg', 'image/png'].includes(file.type)) {
          failures.push(`${file.name}: upload a PDF, JPEG, or PNG file.`);
          continue;
        }
        if (file.size === 0 || file.size > 10 * 1024 * 1024) {
          failures.push(`${file.name}: choose a non-empty file smaller than 10 MB.`);
          continue;
        }

        setSaveState(`Uploading ${file.name}...`, 'saving');
        try {
          const response = await fetch(`/api/application/documents/${category}`, {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
              Accept: 'application/json',
              'Content-Type': file.type,
              'X-File-Name': encodeURIComponent(file.name),
              'X-CSRF-Token': await window.EaimsAuth.getCsrfToken(),
            },
            body: file,
          });
          const payload = await response.json().catch(() => ({}));
          if (!response.ok) {
            const error = new Error(payload.error?.message || 'The document could not be uploaded.');
            error.status = response.status;
            error.fields = payload.error?.fields || {};
            throw error;
          }
          if (category === 'identity') {
            applicationDocuments = applicationDocuments.filter((document) => document.category !== category);
          }
          applicationDocuments.push(payload.data.document);
          renderApplicationDocuments();
          updateApplicationProgress();
        } catch (error) {
          if (error.status === 401 || error.status === 403) {
            window.location.assign('/login.html');
            return;
          }
          failures.push(`${file.name}: ${error.fields?.file || error.message}`);
        }
      }
    } finally {
      pendingUploads = Math.max(0, pendingUploads - 1);
      input.disabled = false;
      input.value = '';
      updateApplicationProgress();
    }
    errorElement.textContent = failures.join(' ');
    errorElement.hidden = failures.length === 0;
    setSaveState(failures.length ? 'Some documents could not be saved' : 'All changes saved', failures.length ? 'error' : 'saved');
    updateApplicationProgress();
  }

  async function deleteApplicationDocument(applicationDocument) {
    const errorElement = documentErrors[applicationDocument.category];
    errorElement.hidden = true;
    try {
      await window.EaimsAuth.request(`/api/application/documents/${encodeURIComponent(applicationDocument.id)}`, {
        method: 'DELETE',
      });
      applicationDocuments = applicationDocuments.filter((item) => item.id !== applicationDocument.id);
      renderApplicationDocuments();
      updateApplicationProgress();
    } catch (error) {
      if (error.status === 401 || error.status === 403) {
        window.location.assign('/login.html');
        return;
      }
      errorElement.textContent = error.message;
      errorElement.hidden = false;
    }
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

  function getProfileFieldValue(field) {
    if (field === 'trainingArrangements') {
      return Array.from(form.querySelectorAll('input[name="trainingArrangements"]:checked'), (input) => input.value);
    }
    if (field === 'gender') return form.querySelector('input[name="gender"]:checked')?.value || '';
    return form.elements.namedItem(field)?.value ?? '';
  }

  function getProfileFieldControl(field) {
    if (field === 'trainingArrangements') return trainingArrangementsGroup;
    if (field === 'gender') {
      return form.querySelector('input[name="gender"]:checked') || form.querySelector('input[name="gender"]');
    }
    return form.elements.namedItem(field);
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
      form.elements.namedItem('nextOfKinName').value,
      form.elements.namedItem('nextOfKinContact').value,
    ];
    const completed = values.filter((value) => String(value || '').trim()).length;
    const state = completed === values.length ? 'complete' : completed ? 'in-progress' : 'not-started';
    progressTag.className = `application-progress-tag is-${state}`;
    progressTag.lastChild.textContent = state === 'complete' ? 'Complete' : state === 'in-progress' ? 'In Progress' : 'Not Started';
    updateApplicationProgress();
  }

  function hasCompletePersonalDetails() {
    const fields = [
      'firstName',
      'lastName',
      'idNumber',
      'countryOfBirth',
      'dateOfBirth',
      'physicalAddress',
      'nextOfKinName',
      'nextOfKinContact',
    ];
    return fields.every((field) => String(form.elements.namedItem(field).value || '').trim())
      && Boolean(form.querySelector('input[name="gender"]:checked'));
  }

  function hasRequiredDocuments() {
    return hasPassportPhoto
      && applicationDocuments.some((document) => document.category === 'transcript')
      && applicationDocuments.some((document) => document.category === 'identity');
  }

  function hasTrainingArrangement() {
    return form.querySelectorAll('input[name="trainingArrangements"]:checked').length > 0;
  }

  function getSubmissionBlockers() {
    const missing = [];
    if (!hasCompletePersonalDetails()) missing.push('complete all required personal details');
    if (!hasTrainingArrangement()) missing.push('choose at least one training arrangement');
    if (!isCurrentProgramChoiceSaved()) missing.push('save a program and intake');
    missing.push(...missingRequiredDocuments().map((item) => `upload ${item}`));
    if (saveState.dataset.state === 'error') missing.push('resolve the save error');
    return missing;
  }

  function setSubmissionLock(isLocked) {
    submissionLocked = isLocked;
    if (!isLocked) return;

    const navigationIds = new Set([
      'continueProgramButton',
      'backToPersonalButton',
      'continueDocumentsButton',
      'backToProgramButton',
    ]);
    form.querySelectorAll('input, select, textarea, button').forEach((control) => {
      if (control.classList.contains('step-navigation-button') || navigationIds.has(control.id)) return;
      control.disabled = true;
    });
    submitApplicationButton.hidden = true;
    submitApplicationButton.disabled = true;
  }

  function renderSubmissionState(submission, applicationNumber) {
    const number = applicationNumber || submission?.applicationNumber || '';
    if (applicationReference && number) applicationReference.textContent = `Application No. ${number}`;
    if (!submission) {
      submissionStatusMessage.hidden = true;
      setSubmissionLock(false);
      return;
    }

    const submittedDate = submission.submittedAt
      ? new Date(submission.submittedAt).toLocaleString()
      : '';
    submissionStatusMessage.textContent = `Application ${number ? `${number} ` : ''}submitted successfully${submittedDate ? ` on ${submittedDate}` : ''}. Your application is now read-only.`;
    submissionStatusMessage.hidden = false;
    setSubmissionLock(true);
  }

  function missingRequiredDocuments() {
    const missing = [];
    if (!hasPassportPhoto) missing.push('a passport photo');
    if (!applicationDocuments.some((document) => document.category === 'transcript')) missing.push('at least one academic transcript');
    if (!applicationDocuments.some((document) => document.category === 'identity')) missing.push('a National ID or passport');
    return missing;
  }

  function isCurrentProgramChoiceSaved() {
    return Boolean(
      selectedProgram
      && selectedProgram.intake
      && selectedProgram.id === pendingProgramId
      && selectedProgram.intake === pendingIntake,
    );
  }

  function updateApplicationProgress() {
    const personalComplete = hasCompletePersonalDetails();
    const selectionComplete = isCurrentProgramChoiceSaved();
    const documentsComplete = hasRequiredDocuments();
    const completion = [personalComplete, selectionComplete, documentsComplete];
    stepper.dataset.activeStep = String(currentStep);

    progressSteps.forEach((step, index) => {
      const complete = completion[index];
      step.classList.toggle('step-complete', complete);
      step.classList.toggle('step-current', index + 1 === currentStep);
      const navigationButton = step.querySelector('.step-navigation-button');
      if (index + 1 === currentStep) navigationButton.setAttribute('aria-current', 'step');
      else navigationButton.removeAttribute('aria-current');
      const status = step.querySelector('small');
      if (status) {
        status.textContent = complete
          ? 'Complete'
          : index + 1 === currentStep ? 'Current step' : visitedSteps.has(index + 1) ? 'In progress' : 'Not started';
      }
    });

    continueProgramButton.disabled = !personalComplete || pendingSaves > 0 || saveTimers.size > 0;
    continueDocumentsButton.disabled = !selectionComplete;
    const submissionBlockers = getSubmissionBlockers();
    const saving = pendingSaves > 0 || saveTimers.size > 0 || saveChains.size > 0 || pendingUploads > 0
      || saveState.dataset.state === 'saving';
    submitApplicationButton.disabled = submissionLocked || submissionBlockers.length > 0 || saving;
    documentUploadStatus.className = `application-progress-tag ${documentsComplete ? 'is-complete' : 'is-in-progress'}`;
    documentUploadStatus.lastChild.textContent = documentsComplete ? 'Complete' : 'Required';
    nextStepHelp.textContent = currentStep === 1
      ? personalComplete ? 'Your personal details are saved. Continue to choose a program.' : 'Complete the required personal details to continue.'
      : currentStep === 2
        ? selectionComplete
          ? `Saved: ${selectedProgram.name} · ${selectedProgram.intake} intake.`
          : 'Select one program and an intake, then save your choice.'
        : submissionLocked
          ? 'Your application has been submitted and is read-only.'
          : submissionBlockers.length
            ? `Before submitting, ${submissionBlockers.join('; ')}.`
            : saving
              ? 'Wait for your latest changes and uploads to finish saving.'
              : 'Your application is complete and ready to submit.';
  }

  function setProgramSummary(program, intake) {
    if (!program) {
      programChoiceSummary.hidden = true;
      return;
    }
    programChoiceName.textContent = program.name;
    programChoiceLevel.textContent = program.level;
    programChoiceDuration.textContent = program.duration;
    programChoiceTuition.textContent = program.tuition || '—';
    programChoiceIntake.textContent = intake ? `${intake} intake` : 'Choose an intake';
    programChoiceSummary.hidden = false;
  }

  function renderProgramTable(level, selectedId = '') {
    const choices = programs.filter((program) => program.level === level);
    programTableBody.replaceChildren();
    programTableWrapper.hidden = !choices.length;
    choices.forEach((program) => {
      const row = document.createElement('tr');
      const selectCell = document.createElement('td');
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'programChoice';
      radio.value = program.id;
      radio.checked = program.id === selectedId;
      radio.setAttribute('aria-label', `Select ${program.name}`);
      radio.addEventListener('change', () => {
        pendingProgramId = program.id;
        if (!program.availableIntakes.includes(pendingIntake)) pendingIntake = '';
        renderIntakeCards(pendingIntake);
        programTableBody.querySelectorAll('tr').forEach((item) => {
          item.classList.toggle('is-selected', item.querySelector('input[type="radio"]').checked);
        });
        updateProgramChoice();
      });
      selectCell.appendChild(radio);
      const nameCell = document.createElement('td');
      const name = document.createElement('strong');
      name.textContent = program.name;
      nameCell.appendChild(name);
      if (program.eligibility) {
        const eligibility = document.createElement('small');
        eligibility.textContent = `Eligibility: ${program.eligibility}`;
        nameCell.appendChild(eligibility);
      }
      const durationCell = document.createElement('td');
      durationCell.textContent = program.duration;
      const tuitionCell = document.createElement('td');
      tuitionCell.textContent = program.tuition || '—';
      row.append(selectCell, nameCell, durationCell, tuitionCell);
      row.classList.toggle('is-selected', radio.checked);
      programTableBody.appendChild(row);
    });
    programHelp.textContent = choices.length
      ? `${choices.length} programs available. Select one program.`
      : 'There are no listed programs for this study level.';
  }

  function renderIntakeCards(selectedIntake = '') {
    intakeCards.replaceChildren();
    const program = programs.find((item) => item.id === pendingProgramId);
    const availableIntakes = program
      ? intakes.filter((intake) => program.availableIntakes.includes(intake))
      : [];
    availableIntakes.forEach((intake) => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'intake-card';
      card.dataset.intake = intake;
      card.setAttribute('aria-pressed', String(intake === selectedIntake));
      if (intake === selectedIntake) card.classList.add('is-selected');
      const icon = document.createElement('span');
      icon.className = 'intake-card-icon';
      const iconElement = document.createElement('i');
      iconElement.className = 'fas fa-calendar-check';
      iconElement.setAttribute('aria-hidden', 'true');
      icon.appendChild(iconElement);
      const name = document.createElement('strong');
      name.textContent = `${intake} Intake`;
      const note = document.createElement('small');
      note.textContent = 'Available intake';
      card.append(icon, name, note);
      card.addEventListener('click', () => {
        pendingIntake = intake;
        intakeCards.querySelectorAll('.intake-card').forEach((item) => {
          const selected = item === card;
          item.classList.toggle('is-selected', selected);
          item.setAttribute('aria-pressed', String(selected));
        });
        updateProgramChoice();
      });
      intakeCards.appendChild(card);
    });
    if (selectedIntake && !availableIntakes.includes(selectedIntake)) pendingIntake = '';
  }

  function updateProgramChoice() {
    const program = programs.find((item) => item.id === pendingProgramId);
    setProgramSummary(program, pendingIntake);
    const isSavedChoice = Boolean(program && isCurrentProgramChoiceSaved());
    saveProgramButton.disabled = !program || !pendingIntake || isSavedChoice;
    saveProgramButton.textContent = isSavedChoice ? 'Program Choice Saved' : selectedProgram ? 'Update Program Choice' : 'Save Program Choice';
    programSelectionStatus.className = `application-progress-tag ${isSavedChoice ? 'is-complete' : 'is-in-progress'}`;
    programSelectionStatus.lastChild.textContent = isSavedChoice
      ? 'Saved'
      : !program || !pendingIntake ? 'One choice' : 'Ready to save';
    updateApplicationProgress();
  }

  function showStep(step, scroll = true) {
    currentStep = step;
    visitedSteps.add(step);
    personalInfoSection.hidden = step !== 1;
    programSelectionSection.hidden = step !== 2;
    documentUploadSection.hidden = step !== 3;
    continueProgramButton.hidden = step !== 1;
    backToPersonalButton.hidden = step !== 2;
    saveProgramButton.hidden = step !== 2;
    continueDocumentsButton.hidden = step !== 2;
    backToProgramButton.hidden = step !== 3;
    submitApplicationButton.hidden = step !== 3 || submissionLocked;
    updateApplicationProgress();
    if (scroll) {
      const section = [personalInfoSection, programSelectionSection, documentUploadSection][step - 1];
      section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function selectProgramLevel(level) {
    const isChangingLevel = activeProgramLevel !== level;
    activeProgramLevel = level;
    setTrainingArrangementForLevel(level);
    if (isChangingLevel) {
      pendingProgramId = selectedProgram && selectedProgram.level === level ? selectedProgram.id : '';
    }
    programLevelButtons.forEach((button) => {
      const selected = button.dataset.programLevel === level;
      button.classList.toggle('is-selected', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
    programError.hidden = true;
    programError.textContent = '';
    renderProgramTable(level, pendingProgramId);
    updateProgramChoice();
  }

  function setTrainingArrangementForLevel(level) {
    const requiredArrangement = {
      'Short courses': 'Online',
      Certificate: 'Weekday',
      Diploma: 'Weekend',
    }[level];
    const correspondenceInput = trainingArrangementInputs.find((input) => input.value === 'By Correspondence');
    const correspondenceSelected = Boolean(correspondenceInput && correspondenceInput.checked);
    trainingArrangementInputs.forEach((input) => {
      const isCorrespondence = input.value === 'By Correspondence';
      input.disabled = !isCorrespondence;
      input.checked = isCorrespondence
        ? correspondenceSelected
        : Boolean(requiredArrangement && input.value === requiredArrangement);
    });
  }

  async function loadApplicationProfile() {
    try {
      const [payload] = await Promise.all([
        window.EaimsAuth.request('/api/application/profile'),
        window.EaimsAuth.getCsrfToken(),
      ]);
      const profile = payload.data.profile;
      countrySelect.innerHTML = '<option value="">Select your country</option>' + payload.data.countries
        .map((country) => `<option value="${country}">${country}</option>`)
        .join('');
      if (!Array.isArray(payload.data.programs) || payload.data.programs.length === 0) {
        throw new Error('The program list is temporarily unavailable. Try again later.');
      }
      if (!Array.isArray(payload.data.intakes) || payload.data.intakes.length === 0) {
        throw new Error('The intake list is temporarily unavailable. Try again later.');
      }
      programs = payload.data.programs;
      intakes = payload.data.intakes;
      renderIntakeCards();
      for (const field of [
        'firstName',
        'lastName',
        'idNumber',
        'countryOfBirth',
        'dateOfBirth',
        'gender',
        'physicalAddress',
        'nextOfKinName',
        'nextOfKinContact',
        'email',
        'phone',
      ]) {
        setFieldValue(field, profile[field]);
      }
      const selectedArrangements = Array.isArray(profile.trainingArrangements) ? profile.trainingArrangements : [];
      trainingArrangementInputs.forEach((input) => {
        input.checked = selectedArrangements.includes(input.value);
      });
      setFieldValue('courseReason', profile.courseReason);
      hasPassportPhoto = Boolean(profile.hasPassportPhoto);
      if (hasPassportPhoto) showProfilePhoto(`/api/application/profile/photo?updated=${Date.now()}`);
      applicationDocuments = Array.isArray(profile.documents) ? profile.documents : [];
      renderApplicationDocuments();
      selectedProgram = payload.data.programSelection;
      if (selectedProgram) {
        setTrainingArrangementForLevel(selectedProgram.level);
        const normalizedArrangements = getProfileFieldValue('trainingArrangements');
        const savedArrangements = selectedArrangements.filter((arrangement) => (
          trainingArrangementInputs.some((input) => input.value === arrangement)
        ));
        if (!payload.data.submission
          && JSON.stringify(normalizedArrangements.slice().sort()) !== JSON.stringify(savedArrangements.slice().sort())) {
          await window.EaimsAuth.request('/api/application/profile', {
            method: 'PATCH',
            body: JSON.stringify({ trainingArrangements: normalizedArrangements }),
          });
        }
        activeProgramLevel = selectedProgram.level;
        pendingProgramId = selectedProgram.id;
        pendingIntake = selectedProgram.intake;
        programLevelButtons.forEach((button) => {
          const selected = button.dataset.programLevel === activeProgramLevel;
          button.classList.toggle('is-selected', selected);
          button.setAttribute('aria-pressed', String(selected));
        });
        renderProgramTable(activeProgramLevel, pendingProgramId);
        renderIntakeCards(pendingIntake);
      } else {
        setTrainingArrangementForLevel('');
      }
      updateProgramChoice();
      updateProfileStatus();
      renderSubmissionState(payload.data.submission, profile.applicationNumber);
      showStep(window.location.hash === '#documents' ? 3 : 1, false);
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
    const input = getProfileFieldControl(field);
    if (!input) return;
    const value = getProfileFieldValue(field);
    const errorElement = form.querySelector(`[data-error-for="${CSS.escape(field)}"]`);
    if (errorElement) {
      errorElement.hidden = true;
      errorElement.textContent = '';
    }
    if (input.removeAttribute) input.removeAttribute('aria-invalid');

    pendingSaves += 1;
    setSaveState('Saving changes...', 'saving');
    updateApplicationProgress();
    try {
      await window.EaimsAuth.request('/api/application/profile', {
        method: 'PATCH',
        body: JSON.stringify({ [field]: value }),
        keepalive: true,
      });
      if (JSON.stringify(getProfileFieldValue(field)) === JSON.stringify(value)) {
        dirtyFields.delete(field);
      }
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
      updateApplicationProgress();
    }
  }

  function queueSave(field) {
    if (queuedSaveFields.has(field)) return;
    queuedSaveFields.add(field);
    const previousSave = saveChains.get(field) || Promise.resolve();
    const currentSave = previousSave
      .catch(() => {})
      .then(async () => {
        queuedSaveFields.delete(field);
        await saveField(field);
      });
    saveChains.set(field, currentSave);
    currentSave.catch((error) => {
      showApplicationError(error.message);
      setSaveState('Changes could not be saved', 'error');
    }).finally(() => {
      if (saveChains.get(field) === currentSave) saveChains.delete(field);
      queuedSaveFields.delete(field);
      updateApplicationProgress();
    });
    updateApplicationProgress();
  }

  function scheduleSave(field, immediate = false) {
    dirtyFields.add(field);
    const existing = saveTimers.get(field);
    if (existing) clearTimeout(existing);
    if (immediate) {
      saveTimers.delete(field);
      queueSave(field);
      return;
    }
    saveTimers.set(field, setTimeout(() => {
      saveTimers.delete(field);
      queueSave(field);
    }, 500));
    updateApplicationProgress();
  }

  window.addEventListener('pagehide', () => {
    for (const field of dirtyFields) {
      const timer = saveTimers.get(field);
      if (timer) clearTimeout(timer);
      saveTimers.delete(field);
      const value = getProfileFieldValue(field);
      void window.EaimsAuth.request('/api/application/profile', {
        method: 'PATCH',
        body: JSON.stringify({ [field]: value }),
        keepalive: true,
      }).then(() => {
        if (JSON.stringify(getProfileFieldValue(field)) === JSON.stringify(value)) {
          dirtyFields.delete(field);
        }
      }).catch((error) => {
        console.error(`Unable to save ${field} while leaving the application page.`, error);
      });
    }
  });

  for (const field of [
    'firstName',
    'lastName',
    'idNumber',
    'physicalAddress',
    'nextOfKinName',
    'nextOfKinContact',
  ]) {
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
  trainingArrangementInputs.forEach((input) => {
    input.addEventListener('change', () => scheduleSave('trainingArrangements', true));
  });
  const courseReasonInput = form.elements.namedItem('courseReason');
  courseReasonInput.addEventListener('input', () => scheduleSave('courseReason'));
  courseReasonInput.addEventListener('blur', () => scheduleSave('courseReason', true));

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
    pendingUploads += 1;
    updateApplicationProgress();
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
    } finally {
      pendingUploads = Math.max(0, pendingUploads - 1);
      updateApplicationProgress();
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

  for (const [category, input] of Object.entries(documentInputs)) {
    input.addEventListener('change', () => uploadApplicationDocuments(category, input.files));
  }

  progressSteps.forEach((step) => {
    step.querySelector('.step-navigation-button').addEventListener('click', () => {
      showStep(Number(step.querySelector('.step-navigation-button').dataset.stepTarget));
    });
  });

  programLevelButtons.forEach((button) => {
    button.addEventListener('click', () => selectProgramLevel(button.dataset.programLevel));
  });

  continueProgramButton.addEventListener('click', () => showStep(2));
  backToPersonalButton.addEventListener('click', () => showStep(1));
  continueDocumentsButton.addEventListener('click', () => {
    if (selectedProgram && selectedProgram.intake) showStep(3);
  });
  backToProgramButton.addEventListener('click', () => showStep(2));
  submitApplicationButton.addEventListener('click', async () => {
    const blockers = getSubmissionBlockers();
    if (blockers.length || pendingSaves || saveTimers.size || pendingUploads || submissionLocked) {
      updateApplicationProgress();
      return;
    }
    if (!window.confirm('Submit your application now? You will not be able to edit it after submission.')) return;

    submitApplicationButton.disabled = true;
    submitApplicationButton.setAttribute('aria-busy', 'true');
    clearApplicationError();
    try {
      const payload = await window.EaimsAuth.request('/api/application/submit', { method: 'POST' });
      renderSubmissionState(payload.data.submission, payload.data.submission.applicationNumber);
      updateApplicationProgress();
    } catch (error) {
      if (error.status === 401 || error.status === 403) {
        window.location.assign('/login.html');
        return;
      }
      showApplicationError(error.message);
      if (error.fields) {
        if (error.fields.programSelection) showStep(2);
        else if (error.fields.transcript || error.fields.identity || error.fields.passportPhoto) showStep(3);
        else showStep(1);
        for (const [field, message] of Object.entries(error.fields)) {
          const inlineError = form.querySelector(`[data-error-for="${CSS.escape(field)}"]`);
          const uploadError = documentErrors[field];
          const errorElement = inlineError || uploadError;
          if (!errorElement) continue;
          errorElement.textContent = message;
          errorElement.hidden = false;
          const input = field === 'gender'
            ? form.querySelector('input[name="gender"]')
            : field === 'trainingArrangements'
              ? form.querySelector('input[name="trainingArrangements"]')
              : form.elements.namedItem(field);
          input?.setAttribute('aria-invalid', 'true');
        }
        if (error.fields.programSelection) {
          programError.textContent = error.fields.programSelection;
          programError.hidden = false;
        }
      }
    } finally {
      submitApplicationButton.removeAttribute('aria-busy');
      updateApplicationProgress();
    }
  });

  programTableBody.addEventListener('change', () => {
    programError.hidden = true;
    programError.textContent = '';
  });

  saveProgramButton.addEventListener('click', async () => {
    programError.hidden = true;
    programError.textContent = '';
    saveProgramButton.disabled = true;
    saveProgramButton.setAttribute('aria-busy', 'true');
    saveProgramButton.textContent = 'Saving choice...';
    try {
      const payload = await window.EaimsAuth.request('/api/application/program-selection', {
        method: 'PUT',
        body: JSON.stringify({ programId: pendingProgramId, intake: pendingIntake }),
      });
      selectedProgram = payload.data.programSelection;
      pendingProgramId = selectedProgram.id;
      pendingIntake = selectedProgram.intake;
      renderIntakeCards(pendingIntake);
      renderProgramTable(selectedProgram.level, selectedProgram.id);
      updateProgramChoice();
      updateApplicationProgress();
      clearApplicationError();
    } catch (error) {
      if (error.status === 401 || error.status === 403) {
        window.location.assign('/login.html');
        return;
      }
      if (error.status === 409 && error.fields) {
        showStep(1);
        showApplicationError(error.message);
        const firstInvalidField = Object.entries(error.fields).find(([field]) => {
          const errorElement = form.querySelector(`[data-error-for="${CSS.escape(field)}"]`);
          const input = field === 'gender'
            ? form.querySelector('input[name="gender"]')
            : form.elements.namedItem(field);
          if (!errorElement || !input) return false;
          errorElement.textContent = error.fields[field];
          errorElement.hidden = false;
          input.setAttribute('aria-invalid', 'true');
          return true;
        });
        if (firstInvalidField) {
          const input = firstInvalidField[0] === 'gender'
            ? form.querySelector('input[name="gender"]')
            : form.elements.namedItem(firstInvalidField[0]);
          input.focus();
        }
        return;
      }
      programError.textContent = error.fields?.programId || error.message;
      if (error.fields?.intake) programError.textContent = error.fields.intake;
      programError.hidden = false;
    } finally {
      saveProgramButton.removeAttribute('aria-busy');
      updateProgramChoice();
    }
  });

  showStep(1, false);
  loadApplicationProfile();
}());
