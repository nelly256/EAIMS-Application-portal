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
      document.getElementById('applicationStatusText').textContent = profileStatus;
      document.getElementById('applicationStateLabel').className = `application-state ${profilePercent === 100 ? 'is-complete' : completedFields ? 'is-in-progress' : 'is-not-started'}`;
      document.getElementById('applicationStateLabel').lastChild.textContent = profilePercent === 100 ? 'Complete' : completedFields ? 'In progress' : 'Not started';
      document.getElementById('profileProgressCount').textContent = `${completedFields} of ${profileFields.length} details complete`;
      document.getElementById('profileCompletionPercent').textContent = `${profilePercent}%`;
      document.getElementById('profileCompletionLabel').textContent = profilePercent === 100
        ? 'Your application profile is complete and ready for the next step.'
        : 'Complete your personal information and upload a passport photo to continue.';
      document.getElementById('profileProgressBar').style.width = `${profilePercent}%`;
      document.getElementById('profileProgress').setAttribute('aria-valuenow', String(profilePercent));
      const personalInfoComplete = profilePercent === 100;
      document.getElementById('personalInfoChecklist').classList.toggle('is-complete', personalInfoComplete);
      document.getElementById('personalInfoChecklistStatus').textContent = profilePercent === 100 ? 'Complete' : completedFields ? 'In progress' : 'Upcoming';
      document.getElementById('personalInfoChecklistDescription').textContent = personalInfoComplete
        ? 'Application profile details saved'
        : `${completedFields} of ${profileFields.length} application details saved`;
      document.getElementById('documentSummary').textContent = applicationProfile.hasPassportPhoto
        ? 'Passport photo uploaded'
        : 'Passport photo not uploaded';
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
