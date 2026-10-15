(function () {
  'use strict';

  const logoutButton = document.getElementById('logoutButton');
  const dashboardContent = document.getElementById('dashboardContent');
  const dashboardError = document.getElementById('dashboardError');

  function showView(name) {
    const showProfile = name === 'profile';
    dashboardContent.querySelectorAll(':scope > section').forEach((section) => {
      section.hidden = showProfile ? section.id !== 'profile' : section.id === 'profile';
    });
    document.querySelectorAll('.sidebar-link[data-view]').forEach((link) => {
      const active = link.dataset.view === name;
      link.classList.toggle('is-active', active);
      if (active) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
    });
    const title = document.getElementById('viewTitle');
    if (title) title.textContent = showProfile ? 'Profile' : 'Dashboard';
  }

  document.querySelectorAll('[data-view]').forEach((link) => {
    link.addEventListener('click', (event) => {
      event.preventDefault();
      history.replaceState(null, '', `#${link.dataset.view}`);
      showView(link.dataset.view);
    });
  });

  async function loadDashboard() {
    try {
      const payload = await window.EaimsAuth.request('/api/dashboard');
      const applicant = payload.data.applicant;
      const fullName = [applicant.otherNames, applicant.surname].filter(Boolean).join(' ') || 'Applicant';
      const firstName = applicant.otherNames || applicant.surname || 'Applicant';
      const applicationProfile = payload.data.applicationProfile || {};
      const programSelection = payload.data.programSelection;
      const documents = Array.isArray(payload.data.documents) ? payload.data.documents : [];
      const hasCompleteProgramChoice = Boolean(programSelection && programSelection.intake);
      const hasCompleteDocuments = Boolean(
        applicationProfile.hasPassportPhoto
        && documents.some((document) => document.category === 'transcript')
        && documents.some((document) => document.category === 'identity'),
      );
      const initials = [applicant.otherNames, applicant.surname]
        .filter(Boolean)
        .map((name) => name.trim()[0])
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

      document.getElementById('headerApplicantName').textContent = fullName;
      document.getElementById('applicantInitials').textContent = initials;
      document.getElementById('applicantFirstName').textContent = firstName;
      document.getElementById('applicantNameDetail').textContent = fullName;
      document.getElementById('applicantEmail').textContent = applicant.email || 'Not provided';
      document.getElementById('applicantPhone').textContent = applicant.phone || 'Not provided';
      document.getElementById('applicantNationality').textContent = applicant.nationality || 'Not provided';
      document.getElementById('applicantDob').textContent = applicant.dateOfBirth ? new Date(`${applicant.dateOfBirth}T00:00:00`).toLocaleDateString() : 'Not provided';
      document.getElementById('applicationStatusText').textContent = programSelection
        ? hasCompleteProgramChoice ? 'Program and intake selected' : 'Choose an intake to finish program selection'
        : profileStatus;
      document.getElementById('applicationStateLabel').className = `application-state ${hasCompleteProgramChoice || profilePercent === 100 ? 'is-complete' : completedFields ? 'is-in-progress' : 'is-not-started'}`;
      document.getElementById('applicationStateLabel').lastChild.textContent = programSelection
        ? hasCompleteProgramChoice ? 'Program selected' : 'Intake needed'
        : profilePercent === 100 ? 'Complete' : completedFields ? 'In progress' : 'Not started';
      document.getElementById('profileProgressCount').textContent = `${completedFields} of ${profileFields.length} details complete`;
      document.getElementById('profileCompletionPercent').textContent = `${profilePercent}%`;
      document.getElementById('profileCompletionLabel').textContent = profilePercent === 100
        ? 'Your personal details and passport photo are complete.'
        : 'Complete your personal information and upload a passport photo.';
      document.getElementById('profileProgressBar').style.width = `${profilePercent}%`;
      document.getElementById('profileProgress').setAttribute('aria-valuenow', String(profilePercent));
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
      document.getElementById('nextStepDescription').textContent = programSelection
        ? hasCompleteProgramChoice
          ? `Your selected program is ${programSelection.name} for the ${programSelection.intake} intake. You can review or change your choice here.`
          : `You selected ${programSelection.name}. Choose an intake to complete your choice.`
        : 'Complete your personal information to choose a program, then upload your required documents.';
      document.getElementById('continueApplicationLink').firstChild.textContent = hasCompleteProgramChoice
        ? 'Review Program Choice '
        : 'Continue to My Application ';
      document.getElementById('programSelectionChecklist').classList.toggle('is-complete', hasCompleteProgramChoice);
      document.getElementById('programSelectionChecklistDescription').textContent = programSelection
        ? hasCompleteProgramChoice
          ? `${programSelection.name} · ${programSelection.intake} intake`
          : `${programSelection.name} · intake not selected`
        : 'Choose one program during your application';
      document.getElementById('programSelectionChecklistStatus').textContent = hasCompleteProgramChoice
        ? 'Selected'
        : programSelection ? 'Intake needed' : 'Upcoming';
      dashboardContent.hidden = false;
      showView(window.location.hash === '#profile' ? 'profile' : 'overview');
    } catch (error) {
      dashboardContent.hidden = true;
      window.EaimsAuth.showFormMessage(dashboardError, error.message);
      if (error.status === 401 || error.code === 'VERIFICATION_REQUIRED') window.location.assign('/login.html');
    }
  }

  logoutButton?.addEventListener('click', async () => {
    logoutButton.disabled = true;
    try {
      const payload = await window.EaimsAuth.request('/api/auth/logout', { method: 'POST' });
      window.EaimsAuth.clearCsrfToken();
      window.location.assign(payload.data.redirect);
    } catch (error) {
      window.EaimsAuth.showFormMessage(dashboardError, error.message);
      logoutButton.disabled = false;
    }
  });

  loadDashboard();
}());
