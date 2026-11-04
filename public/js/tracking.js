'use strict';

(function () {
  const content = document.getElementById('trackingContent');
  const error = document.getElementById('trackingError');
  const logoutButton = document.getElementById('logoutButton');

  function setProfileState(element, state) {
    element.classList.remove('is-complete', 'is-in-progress', 'is-upcoming');
    element.classList.add(`is-${state}`);
  }

  const applicationStatuses = ['submitted', 'in_review', 'approved', 'admitted'];
  const statusLabels = {
    submitted: 'Submitted',
    in_review: 'In review',
    approved: 'Approved',
    admitted: 'Admitted',
  };
  const statusMessages = {
    submitted: 'Your application has been submitted successfully.',
    in_review: 'Your application is being reviewed by admissions.',
    approved: 'Your application has been approved.',
    admitted: 'Congratulations! Your admission has been confirmed.',
  };

  const informationRequestPanel = document.getElementById('informationRequestsPanel');
  const informationRequestList = document.getElementById('informationRequestList');

  function appendInformationRequestForm(card, request) {
    const form = document.createElement('form');
    form.className = 'information-request-form';
    form.noValidate = false;
    request.requestedItems.forEach((item, index) => {
      const field = document.createElement('div');
      field.className = 'information-request-field';
      const label = document.createElement('label');
      label.textContent = item.label || item.key;
      if (item.type === 'field') {
        const input = document.createElement('textarea');
        input.id = `information-${request.id}-${index}`;
        input.required = true;
        input.maxLength = 4000;
        input.dataset.requestField = item.key;
        label.htmlFor = input.id;
        field.append(label, input);
      } else {
        const input = document.createElement('input');
        input.id = `information-${request.id}-${index}`;
        input.type = 'file';
        input.multiple = true;
        input.required = true;
        input.accept = 'application/pdf,image/jpeg,image/png';
        input.dataset.documentInput = '';
        input.dataset.documentKey = item.key;
        label.htmlFor = input.id;
        field.append(label, input);
        const help = document.createElement('small');
        help.textContent = 'PDF, JPEG or PNG; up to 10 MB per file.';
        field.append(help);
      }
      form.append(field);
    });

    const message = document.createElement('p');
    message.className = 'information-request-form-message';
    message.setAttribute('role', 'status');
    message.hidden = true;
    const submit = document.createElement('button');
    submit.type = 'submit';
    submit.className = 'information-request-submit';
    submit.textContent = 'Submit response';
    form.append(message, submit);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      message.hidden = true;
      submit.disabled = true;
      submit.textContent = 'Submitting...';
      try {
        const values = {};
        form.querySelectorAll('[data-request-field]').forEach((input) => {
          values[input.dataset.requestField] = input.value.trim();
        });
        const documentsByKey = {};
        for (const input of form.querySelectorAll('[data-document-input]')) {
          documentsByKey[input.dataset.documentKey] = [];
          for (const file of input.files) {
            const query = new URLSearchParams({ name: file.name });
            const upload = await fetch(
              `/api/application/information-requests/${encodeURIComponent(request.id)}/documents?${query}`,
              {
                method: 'POST',
                credentials: 'same-origin',
                headers: {
                  Accept: 'application/json',
                  'Content-Type': file.type,
                  'X-CSRF-Token': await window.EaimsAuth.getCsrfToken(),
                },
                body: file,
              },
            );
            const uploadPayload = await upload.json().catch(() => ({}));
            if (!upload.ok) {
              throw new Error(uploadPayload.error?.message || `Unable to upload ${file.name}.`);
            }
            documentsByKey[input.dataset.documentKey].push(String(uploadPayload.data.document.id));
          }
        }
        await window.EaimsAuth.request(
          `/api/application/information-requests/${encodeURIComponent(request.id)}/responses`,
          {
            method: 'POST',
            body: JSON.stringify({ values, documentsByKey }),
          },
        );
        await loadInformationRequests(true);
      } catch (requestError) {
        if (requestError.status === 401 || requestError.status === 403) {
          window.location.assign('/login.html');
          return;
        }
        if (requestError.status === 409) {
          await loadInformationRequests(true);
          return;
        }
        message.textContent = requestError.message;
        message.className = 'information-request-form-message form-message form-message-error';
        message.hidden = false;
        submit.disabled = false;
        submit.textContent = 'Submit response';
      }
    });
    card.append(form);
  }

  function renderInformationRequests(requests) {
    informationRequestList.replaceChildren();
    if (!requests.length) {
      const empty = document.createElement('p');
      empty.className = 'information-request-empty';
      empty.textContent = 'Admissions has not requested any additional information.';
      informationRequestList.append(empty);
      return;
    }

    requests.forEach((request) => {
      const card = document.createElement('article');
      card.className = 'information-request-card';
      const heading = document.createElement('h3');
      heading.textContent = 'Admissions request';
      const message = document.createElement('p');
      message.className = 'information-request-message';
      message.textContent = request.applicantMessage;
      card.append(heading, message);

      const details = document.createElement('p');
      details.className = 'information-request-details';
      const dueDate = request.dueAt ? new Date(request.dueAt) : null;
      details.textContent = dueDate && !Number.isNaN(dueDate.getTime())
        ? `Requested ${new Date(request.createdAt).toLocaleDateString()} · Due ${dueDate.toLocaleDateString()}`
        : `Requested ${new Date(request.createdAt).toLocaleDateString()}`;
      card.append(details);

      if (request.response) {
        const status = document.createElement('p');
        status.className = `information-request-status is-${request.response.deliveryStatus}`;
        if (request.response.deliveryStatus === 'delivered') {
          status.textContent = 'Your response was received by admissions.';
        } else if (request.response.deliveryStatus === 'failed') {
          status.textContent = 'We could not deliver your response. Please contact admissions for help.';
        } else {
          status.textContent = 'Your response is saved and waiting to be sent to admissions.';
        }
        card.append(status);
      } else {
        appendInformationRequestForm(card, request);
      }
      informationRequestList.append(card);
    });
  }

  async function loadInformationRequests(isSubmitted) {
    if (!isSubmitted) {
      informationRequestPanel.hidden = true;
      return;
    }
    informationRequestPanel.hidden = false;
    try {
      const payload = await window.EaimsAuth.request('/api/application/information-requests');
      renderInformationRequests(payload.data.requests || []);
    } catch (requestError) {
      if (requestError.status === 401 || requestError.status === 403) {
        window.location.assign('/login.html');
        return;
      }
      informationRequestList.replaceChildren();
      const message = document.createElement('p');
      message.className = 'information-request-empty form-message form-message-error';
      message.textContent = requestError.message;
      informationRequestList.append(message);
    }
  }

  async function loadTracking() {
    try {
      const payload = await window.EaimsAuth.request('/api/application/profile');
      const profile = payload.data.profile;
      const programSelection = payload.data.programSelection;
      const submission = payload.data.submission;
      const notifications = payload.data.notifications || { items: [] };
      const applicationStatus = submission && submission.status;
      const isSubmitted = Boolean(submission);
      const journeyStatus = isSubmitted ? applicationStatus : null;
      const statusIndex = applicationStatuses.indexOf(journeyStatus);
      const values = [
        profile.firstName,
        profile.lastName,
        profile.idNumber,
        profile.countryOfBirth,
        profile.dateOfBirth,
        profile.gender,
        profile.physicalAddress,
        profile.nextOfKinName,
        profile.nextOfKinContact,
        profile.hasPassportPhoto,
      ];
      const documents = Array.isArray(profile.documents) ? profile.documents : [];
      const completed = values.filter((value) => String(value || '').trim()).length;
      const percent = Math.round((completed / values.length) * 100);
      const profileComplete = percent === 100;
      const profileStarted = completed > 0;
      const hasCompleteProgramChoice = Boolean(programSelection && programSelection.intake);
      const documentsComplete = Boolean(
        profile.hasPassportPhoto
        && documents.some((document) => document.category === 'transcript')
        && documents.some((document) => document.category === 'identity'),
      );

      document.getElementById('headerApplicantName').textContent = [profile.firstName, profile.lastName].filter(Boolean).join(' ') || 'Applicant';
      document.getElementById('applicantInitials').textContent = [profile.firstName, profile.lastName]
        .filter(Boolean)
        .map((name) => name.trim()[0])
        .join('')
        .slice(0, 2)
        .toUpperCase() || 'AP';
      document.getElementById('applicationReference').textContent = profile.applicationNumber || 'Application number pending';
      document.getElementById('applicationState').textContent = isSubmitted
        ? statusLabels[applicationStatus] || 'Submitted'
        : 'Not submitted';
      document.getElementById('submittedOn').textContent = submission?.submittedAt
        ? new Date(submission.submittedAt).toLocaleString()
        : 'Not yet';
      document.getElementById('documentsUploaded').textContent = `${documents.length + (profile.hasPassportPhoto ? 1 : 0)} Uploaded`;
      document.getElementById('currentStatus').textContent = isSubmitted
        ? statusMessages[journeyStatus]
        : programSelection
        ? hasCompleteProgramChoice ? 'Program and intake selected' : 'Choose an intake'
        : profileComplete
        ? 'Personal information complete'
        : profileStarted ? 'Personal information in progress' : 'Not started';

      const personalStep = document.getElementById('timelinePersonalInfo');
      setProfileState(personalStep, profileComplete ? 'complete' : profileStarted ? 'in-progress' : 'upcoming');
      document.getElementById('timelinePersonalInfoText').textContent = profileComplete
        ? 'Your personal information is complete.'
        : 'Complete your applicant profile to continue.';
      document.getElementById('timelinePersonalInfoStatus').textContent = profileComplete
        ? 'Complete'
        : profileStarted ? `${completed} of ${values.length} details saved` : 'Not started';

      const programStep = document.getElementById('timelineProgram');
      setProfileState(programStep, hasCompleteProgramChoice ? 'complete' : programSelection || profileComplete ? 'in-progress' : 'upcoming');
      document.getElementById('timelineProgramText').textContent = programSelection
        ? hasCompleteProgramChoice
          ? `Your selected program: ${programSelection.name} (${programSelection.intake} intake).`
          : `Program selected: ${programSelection.name}. Choose an intake to complete your choice.`
        : 'Choose one program after completing personal information.';
      document.getElementById('timelineProgramStatus').textContent = programSelection
        ? hasCompleteProgramChoice ? 'Selected' : 'Intake needed'
        : profileComplete ? 'Ready to select' : 'Not started';

      const documentsStep = document.getElementById('timelineDocuments');
      setProfileState(documentsStep, documentsComplete ? 'complete' : 'in-progress');
      document.getElementById('timelineDocumentsStatus').textContent = documentsComplete ? 'Complete' : 'Required';
      document.getElementById('timelineDocumentsText').textContent = documentsComplete
        ? `${documents.length} supporting documents and passport photo uploaded.`
        : 'Upload a passport photo, at least one academic transcript, and your National ID or passport.';

      const statusSteps = [
        ['timelineSubmitted', 'timelineSubmittedStatus'],
        ['timelineInReview', 'timelineInReviewStatus'],
        ['timelineApproved', 'timelineApprovedStatus'],
        ['timelineAdmitted', 'timelineAdmittedStatus'],
      ];
      statusSteps.forEach(([stepId, labelId], index) => {
        const state = statusIndex < 0 || index > statusIndex
          ? 'upcoming'
          : index === statusIndex ? 'in-progress' : 'complete';
        setProfileState(document.getElementById(stepId), state);
        document.getElementById(labelId).textContent = state === 'complete'
          ? 'Complete'
          : state === 'in-progress' ? 'Current' : 'Upcoming';
      });
      document.getElementById('timelineSubmittedText').textContent = isSubmitted
        ? `Your application was submitted successfully${submission.submittedAt ? ` on ${new Date(submission.submittedAt).toLocaleString()}` : ''}.`
        : 'Submit your completed application for admissions review.';
      document.getElementById('timelineInReviewText').textContent = ['in_review', 'approved', 'admitted'].includes(applicationStatus)
        ? statusMessages.in_review
        : 'Admissions staff will review your application.';
      document.getElementById('timelineApprovedText').textContent = ['approved', 'admitted'].includes(applicationStatus)
        ? statusMessages.approved
        : 'An approval update will appear here when available.';
      document.getElementById('timelineAdmittedText').textContent = applicationStatus === 'admitted'
        ? statusMessages.admitted
        : 'Your admission confirmation will appear here when available.';

      const latestDocument = documents.reduce((latest, document) => (
        !latest || document.created_at > latest.created_at ? document : latest
      ), null);
      const latestDocumentDate = latestDocument ? latestDocument.created_at : '';
      const latestStatusNotification = Array.isArray(notifications.items) ? notifications.items[0] : null;
      const activityRecord = latestStatusNotification
        ? {
          date: latestStatusNotification.createdAt,
          text: `${statusLabels[latestStatusNotification.status] || 'Application status'} update`,
        }
        : isSubmitted
        ? { date: submission.submittedAt, text: 'Application submitted' }
        : hasCompleteProgramChoice && (!profile.updatedAt || programSelection.updatedAt >= profile.updatedAt)
          ? { date: programSelection.updatedAt, text: 'Program choice saved' }
          : latestDocumentDate && (!profile.updatedAt || latestDocumentDate >= profile.updatedAt)
            ? { date: latestDocumentDate, text: 'Supporting document uploaded' }
            : profile.updatedAt ? { date: profile.updatedAt, text: 'Personal information last saved' } : null;
      if (activityRecord) {
        const activityDate = new Date(activityRecord.date);
        document.getElementById('recentActivity').textContent = activityRecord.text;
        const time = document.getElementById('recentActivityDate');
        if (!Number.isNaN(activityDate.getTime())) {
          time.dateTime = activityDate.toISOString();
          time.textContent = activityDate.toLocaleString();
          time.hidden = false;
        }
      }
      content.hidden = false;
      loadInformationRequests(isSubmitted);
    } catch (requestError) {
      if (requestError.status === 401 || requestError.status === 403) {
        window.location.assign('/login.html');
        return;
      }
      window.EaimsAuth.showFormMessage(error, requestError.message);
    }
  }

  logoutButton?.addEventListener('click', async () => {
    logoutButton.disabled = true;
    try {
      const payload = await window.EaimsAuth.request('/api/auth/logout', { method: 'POST' });
      window.EaimsAuth.clearCsrfToken();
      window.location.assign(payload.data.redirect);
    } catch (requestError) {
      window.EaimsAuth.showFormMessage(error, requestError.message);
      logoutButton.disabled = false;
    }
  });

  loadTracking();
}());
