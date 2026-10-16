'use strict';

(function () {
  const content = document.getElementById('trackingContent');
  const error = document.getElementById('trackingError');
  const logoutButton = document.getElementById('logoutButton');

  function setProfileState(element, state) {
    element.classList.remove('is-complete', 'is-in-progress', 'is-upcoming');
    element.classList.add(`is-${state}`);
  }

  async function loadTracking() {
    try {
      const payload = await window.EaimsAuth.request('/api/application/profile');
      const profile = payload.data.profile;
      const programSelection = payload.data.programSelection;
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
      document.getElementById('applicationState').textContent = 'Not submitted';
      document.getElementById('submittedOn').textContent = 'Not yet';
      document.getElementById('documentsUploaded').textContent = `${documents.length + (profile.hasPassportPhoto ? 1 : 0)} Uploaded`;
      document.getElementById('currentStatus').textContent = programSelection
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

      const latestDocument = documents.reduce((latest, document) => (
        !latest || document.created_at > latest.created_at ? document : latest
      ), null);
      const latestDocumentDate = latestDocument ? latestDocument.created_at : '';
      const activityRecord = hasCompleteProgramChoice && (!profile.updatedAt || programSelection.updatedAt >= profile.updatedAt)
        ? { date: programSelection.updatedAt, text: 'Program choice saved' }
        : latestDocumentDate && (!profile.updatedAt || latestDocumentDate >= profile.updatedAt)
          ? { date: latestDocumentDate, text: 'Supporting document uploaded' }
          : profile.updatedAt ? { date: profile.updatedAt, text: 'Personal information last saved' } : null;
      if (activityRecord) {
        const activityDate = new Date(activityRecord.date);
        document.getElementById('recentActivity').textContent = activityRecord.text;
        const time = document.getElementById('recentActivityDate');
        time.dateTime = activityDate.toISOString();
        time.textContent = activityDate.toLocaleString();
        time.hidden = false;
      }
      content.hidden = false;
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
