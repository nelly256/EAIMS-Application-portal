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
      const values = [
        profile.firstName,
        profile.lastName,
        profile.idNumber,
        profile.countryOfBirth,
        profile.dateOfBirth,
        profile.gender,
        profile.physicalAddress,
        profile.hasPassportPhoto,
      ];
      const completed = values.filter((value) => String(value || '').trim()).length;
      const percent = Math.round((completed / values.length) * 100);
      const profileComplete = percent === 100;
      const profileStarted = completed > 0;

      document.getElementById('headerApplicantName').textContent = [profile.firstName, profile.lastName].filter(Boolean).join(' ') || 'Applicant';
      document.getElementById('applicantInitials').textContent = [profile.firstName, profile.lastName]
        .filter(Boolean)
        .map((name) => name.trim()[0])
        .join('')
        .slice(0, 2)
        .toUpperCase() || 'AP';
      document.getElementById('applicationState').textContent = 'Not submitted';
      document.getElementById('submittedOn').textContent = 'Not yet';
      document.getElementById('documentsUploaded').textContent = profile.hasPassportPhoto ? '1 Uploaded' : '0 Uploaded';
      document.getElementById('currentStatus').textContent = profileComplete
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

      if (profile.updatedAt) {
        const activityDate = new Date(profile.updatedAt);
        document.getElementById('recentActivity').textContent = 'Personal information last saved';
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
