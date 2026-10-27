(function () {
  'use strict';

  const logoutButton = document.getElementById('logoutButton');
  const dashboardContent = document.getElementById('dashboardContent');
  const dashboardError = document.getElementById('dashboardError');
  const notificationBell = document.getElementById('notificationBell');
  const notificationsPanel = document.getElementById('notificationsPanel');
  const notificationCount = document.getElementById('notificationCount');
  const notificationMessages = {
    submitted: ['Application submitted successfully', 'Your application has been submitted successfully.'],
    in_review: ['Application under review', 'Admissions staff are reviewing your application.'],
    approved: ['Application approved', 'Your application has been approved.'],
    admitted: ['You have been admitted!', 'Congratulations! Your admission has been confirmed.'],
  };
  const applicationStatuses = ['submitted', 'in_review', 'approved', 'admitted'];
  const applicationStatusLabels = {
    submitted: 'Submitted',
    in_review: 'In review',
    approved: 'Approved',
    admitted: 'Admitted',
  };

  function statusLabel(status) {
    return applicationStatusLabels[status] || 'In progress';
  }

  function renderApplicationProgress(status) {
    const journeyStatus = status || null;
    const currentIndex = applicationStatuses.indexOf(journeyStatus);
    document.querySelectorAll('.application-status-step').forEach((step, index) => {
      step.classList.remove('is-complete', 'is-current', 'is-upcoming');
      const state = currentIndex < 0 || index > currentIndex
        ? 'is-upcoming'
        : index === currentIndex ? 'is-current' : 'is-complete';
      step.classList.add(state);
      if (state === 'is-current') step.setAttribute('aria-current', 'step');
      else step.removeAttribute('aria-current');
    });
  }

  function renderNotifications(notifications) {
    const items = notifications && Array.isArray(notifications.items) ? notifications.items : [];
    const unreadCount = Number(notifications && notifications.unreadCount) || 0;
    const notificationsList = document.getElementById('notificationsList');
    notificationsList.replaceChildren();
    items.forEach((notification) => {
      const message = notificationMessages[notification.status];
      if (!message) return;
      const item = document.createElement('li');
      item.className = `notification-item${notification.readAt ? '' : ' is-unread'}`;
      const title = document.createElement('strong');
      title.textContent = message[0];
      const description = document.createElement('span');
      description.textContent = message[1];
      const date = document.createElement('time');
      date.dateTime = notification.createdAt;
      const parsedDate = new Date(notification.createdAt);
      date.textContent = Number.isNaN(parsedDate.getTime()) ? '' : parsedDate.toLocaleString();
      item.append(title, description, date);
      notificationsList.appendChild(item);
    });
    document.getElementById('notificationsEmptyState').hidden = notificationsList.childElementCount > 0;
    notificationCount.textContent = String(unreadCount);
    notificationCount.hidden = unreadCount === 0;
    notificationBell.setAttribute('aria-label', unreadCount
      ? `Notifications, ${unreadCount} unread`
      : 'Notifications');
  }

  function renderAnnouncements(announcements) {
    const section = document.getElementById('applicantAnnouncements');
    const list = document.getElementById('applicantAnnouncementsList');
    list.replaceChildren();
    (Array.isArray(announcements) ? announcements : []).forEach((announcement) => {
      const item = document.createElement('li');
      const title = document.createElement('h3');
      title.textContent = announcement.title;
      const body = document.createElement('p');
      body.textContent = announcement.body;
      const date = document.createElement('time');
      date.dateTime = announcement.createdAt;
      const parsedDate = new Date(announcement.createdAt);
      date.textContent = Number.isNaN(parsedDate.getTime()) ? '' : parsedDate.toLocaleString();
      item.append(title, body, date);
      list.appendChild(item);
    });
    section.hidden = list.childElementCount === 0;
  }

  function displayValue(value) {
    const text = String(value || '').trim();
    return text || 'Not provided';
  }

  async function loadDashboard() {
    try {
      const payload = await window.EaimsAuth.request('/api/dashboard');
      const applicant = payload.data.applicant;
      const applicationProfile = payload.data.applicationProfile || {};
      const profileFullName = [applicationProfile.firstName, applicationProfile.lastName].filter(Boolean).join(' ');
      const fullName = profileFullName || [applicant.otherNames, applicant.surname].filter(Boolean).join(' ') || 'Applicant';
      const firstName = applicationProfile.firstName || applicant.otherNames || applicant.surname || 'Applicant';
      const programSelection = payload.data.programSelection;
      const submission = payload.data.application;
      const applicationStatus = submission && submission.status;
      const isSubmitted = Boolean(submission);
      const currentStatusLabel = statusLabel(applicationStatus);
      const documents = Array.isArray(payload.data.documents) ? payload.data.documents : [];
      const hasCompleteProgramChoice = Boolean(programSelection && programSelection.intake);
      const hasCompleteDocuments = Boolean(
        applicationProfile.hasPassportPhoto
        && documents.some((document) => document.category === 'transcript')
        && documents.some((document) => document.category === 'identity'),
      );
      const initials = fullName
        .split(/\s+/)
        .filter(Boolean)
        .map((name) => name[0])
        .join('')
        .slice(0, 2)
        .toUpperCase() || 'AP';
      const profileFields = [
        applicationProfile.firstName,
        applicationProfile.lastName,
        applicationProfile.idNumber,
        applicationProfile.countryOfBirth,
        applicationProfile.dateOfBirth,
        applicationProfile.gender,
        applicationProfile.physicalAddress,
        applicationProfile.nextOfKinName,
        applicationProfile.nextOfKinContact,
        applicationProfile.hasPassportPhoto,
      ];
      const completedFields = profileFields.filter((value) => String(value || '').trim()).length;
      const profilePercent = Math.round((completedFields / profileFields.length) * 100);
      const profileStatus = profilePercent === 100
        ? 'Personal information complete'
        : completedFields > 0 ? 'Personal information in progress' : 'Not started';
      const applicationStateClass = isSubmitted
        ? applicationStatus === 'admitted' ? 'is-complete' : 'is-in-progress'
        : hasCompleteProgramChoice || profilePercent === 100
          ? 'is-complete'
          : completedFields ? 'is-in-progress' : 'is-not-started';

      document.getElementById('headerApplicantName').textContent = fullName;
      document.getElementById('applicantInitials').textContent = initials;
      document.getElementById('applicantFirstName').textContent = firstName;
      document.getElementById('applicantNameDetail').textContent = fullName;
      document.getElementById('applicantEmail').textContent = displayValue(applicant.email);
      document.getElementById('applicantPhone').textContent = displayValue(applicant.phone);
      document.getElementById('applicantNationality').textContent = displayValue(applicant.nationality);
      const dateOfBirth = applicationProfile.dateOfBirth || applicant.dateOfBirth;
      document.getElementById('applicantDob').textContent = dateOfBirth
        ? new Date(`${dateOfBirth}T00:00:00`).toLocaleDateString()
        : 'Not provided';
      document.getElementById('applicantApplicationNumber').textContent = displayValue(applicant.applicationNumber);
      document.getElementById('applicationStatusText').textContent = isSubmitted
        ? applicationStatus === 'admitted'
          ? 'You have been admitted'
          : applicationStatus === 'approved'
            ? 'Your application has been approved'
            : applicationStatus === 'in_review'
              ? 'Your application is under review'
              : 'Application submitted successfully'
        : programSelection
        ? hasCompleteProgramChoice ? 'Program and intake selected' : 'Choose an intake to finish program selection'
        : profileStatus;
      document.getElementById('applicationStateLabel').className = `application-state ${applicationStateClass}`;
      document.getElementById('applicationStateLabel').lastChild.textContent = isSubmitted
        ? currentStatusLabel
        : programSelection
        ? hasCompleteProgramChoice ? 'Program selected' : 'Intake needed'
        : profilePercent === 100 ? 'Complete' : completedFields ? 'In progress' : 'Not started';
      document.getElementById('profileProgressCount').textContent = `${completedFields} of ${profileFields.length} details complete`;
      document.getElementById('profileCompletionPercent').textContent = `${profilePercent}%`;
      document.getElementById('profileCompletionLabel').textContent = profilePercent === 100
        ? 'Your personal details and passport photo are complete.'
        : 'Complete your personal information and upload a passport photo.';
      document.getElementById('profileProgressBar').style.width = `${profilePercent}%`;
      document.getElementById('profileProgress').setAttribute('aria-valuenow', String(profilePercent));
      renderApplicationProgress(applicationStatus);
      const personalInfoComplete = profilePercent === 100;
      document.getElementById('personalInfoChecklist').classList.toggle('is-complete', personalInfoComplete);
      document.getElementById('personalInfoChecklistStatus').textContent = profilePercent === 100 ? 'Complete' : completedFields ? 'In progress' : 'Upcoming';
      document.getElementById('personalInfoChecklistDescription').textContent = personalInfoComplete
        ? 'Application profile details saved'
        : `${completedFields} of ${profileFields.length} application details saved`;
      const totalDocumentCount = documents.length + (applicationProfile.hasPassportPhoto ? 1 : 0);
      document.getElementById('documentSummary').textContent = hasCompleteDocuments
        ? `${totalDocumentCount} documents uploaded`
        : `${totalDocumentCount} uploaded · required documents missing`;
      document.getElementById('documentChecklist').classList.toggle('is-complete', hasCompleteDocuments);
      document.getElementById('documentChecklistStatus').textContent = hasCompleteDocuments ? 'Complete' : 'Required';
      document.getElementById('documentChecklistDescription').textContent = hasCompleteDocuments
        ? `${documents.length} supporting documents and passport photo uploaded`
        : 'Upload a passport photo, at least one transcript, and an ID or passport';

      const recentDocumentsList = document.getElementById('recentDocumentsList');
      recentDocumentsList.replaceChildren();
      document.getElementById('recentDocumentsEmptyState').hidden = documents.length > 0;
      documents.forEach((applicationDocument) => {
        const item = document.createElement('li');
        const link = document.createElement('a');
        link.href = `/api/application/documents/${encodeURIComponent(applicationDocument.id)}`;
        link.download = applicationDocument.original_name;
        link.textContent = applicationDocument.original_name;
        const category = document.createElement('small');
        category.textContent = applicationDocument.category === 'transcript'
          ? 'Academic transcript'
          : applicationDocument.category === 'identity' ? 'National ID or passport' : 'Additional document';
        item.append(link, category);
        recentDocumentsList.appendChild(item);
      });
      document.getElementById('nextStepDescription').textContent = isSubmitted
        ? applicationStatus === 'admitted'
          ? 'Congratulations! You have been admitted.'
          : applicationStatus === 'approved'
            ? `Your application ${applicant.applicationNumber ? `(${applicant.applicationNumber}) ` : ''}has been approved.`
            : applicationStatus === 'in_review'
              ? `Your application ${applicant.applicationNumber ? `(${applicant.applicationNumber}) ` : ''}is being reviewed.`
              : `Your application ${applicant.applicationNumber ? `(${applicant.applicationNumber}) ` : ''}was submitted successfully${submission.submittedAt ? ` on ${new Date(submission.submittedAt).toLocaleString()}` : ''}.`
        : programSelection
        ? hasCompleteProgramChoice
          ? `Your selected program is ${programSelection.name} for the ${programSelection.intake} intake. You can review or change your choice here.`
          : `You selected ${programSelection.name}. Choose an intake to complete your choice.`
        : 'Complete your personal information to choose a program, then upload your required documents.';
      const continueApplicationLink = document.getElementById('continueApplicationLink');
      continueApplicationLink.href = isSubmitted ? '/track-application' : '/my-application';
      continueApplicationLink.firstChild.textContent = isSubmitted
        ? 'Track My Application '
        : hasCompleteProgramChoice ? 'Review Program Choice ' : 'Continue to My Application ';
      document.getElementById('programSelectionChecklist').classList.toggle('is-complete', hasCompleteProgramChoice);
      document.getElementById('programSelectionChecklistDescription').textContent = programSelection
        ? hasCompleteProgramChoice
          ? `${programSelection.name} · ${programSelection.intake} intake`
          : `${programSelection.name} · intake not selected`
        : 'Choose one program during your application';
      document.getElementById('programSelectionChecklistStatus').textContent = hasCompleteProgramChoice
        ? 'Selected'
        : programSelection ? 'Intake needed' : 'Upcoming';
      document.getElementById('submissionChecklist').classList.toggle('is-complete', isSubmitted);
      document.getElementById('submissionChecklistDescription').textContent = isSubmitted
        ? `${currentStatusLabel}${submission.submittedAt ? ` · Submitted on ${new Date(submission.submittedAt).toLocaleDateString()}` : ''} · ${applicant.applicationNumber || 'Application received'}`
        : 'Submit when all application steps are complete';
      document.getElementById('submissionChecklistStatus').textContent = isSubmitted ? currentStatusLabel : 'Upcoming';
      renderNotifications(payload.data.notifications);
      renderAnnouncements(payload.data.announcements);
      dashboardContent.hidden = false;
    } catch (error) {
      dashboardContent.hidden = true;
      window.EaimsAuth.showFormMessage(dashboardError, error.message);
      if (error.status === 401 || error.code === 'VERIFICATION_REQUIRED') window.location.assign('/login.html');
    }
  }

  logoutButton?.addEventListener('click', async () => {
    logoutButton.disabled = true;
    logoutButton.setAttribute('aria-busy', 'true');
    try {
      const payload = await window.EaimsAuth.request('/api/auth/logout', { method: 'POST' });
      const redirect = payload.data?.redirect;
      if (typeof redirect !== 'string' || !redirect.startsWith('/') || redirect.startsWith('//')) {
        throw new Error('Logout could not be completed. Please try again.');
      }
      window.EaimsAuth.clearCsrfToken();
      window.location.replace(redirect);
    } catch (error) {
      window.EaimsAuth.showFormMessage(dashboardError, error.message);
      logoutButton.disabled = false;
      logoutButton.removeAttribute('aria-busy');
    }
  });

  notificationBell?.addEventListener('click', async () => {
    const opening = notificationsPanel.hidden;
    notificationsPanel.hidden = !opening;
    notificationBell.setAttribute('aria-expanded', String(opening));
    if (!opening || Number(notificationCount.textContent) === 0) return;
    notificationBell.disabled = true;
    try {
      await window.EaimsAuth.request('/api/application/notifications/read', { method: 'POST' });
      const currentItems = Array.from(document.querySelectorAll('.notification-item'));
      currentItems.forEach((item) => item.classList.remove('is-unread'));
      notificationCount.textContent = '0';
      notificationCount.hidden = true;
      notificationBell.setAttribute('aria-label', 'Notifications');
    } catch (error) {
      window.EaimsAuth.showFormMessage(dashboardError, error.message);
    } finally {
      notificationBell.disabled = false;
    }
  });

  document.addEventListener('click', (event) => {
    if (!notificationsPanel.hidden
      && !notificationsPanel.contains(event.target)
      && !notificationBell.contains(event.target)) {
      notificationsPanel.hidden = true;
      notificationBell.setAttribute('aria-expanded', 'false');
    }
  });

  notificationBell?.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      notificationsPanel.hidden = true;
      notificationBell.setAttribute('aria-expanded', 'false');
      notificationBell.focus();
    }
  });

  loadDashboard();
}());
