(function () {
  'use strict';

  const logoutButton = document.getElementById('logoutButton');
  const dashboardContent = document.getElementById('dashboardContent');
  const dashboardError = document.getElementById('dashboardError');

  function showView(name) {
    document.querySelectorAll('.dashboard-view').forEach((view) => { view.hidden = view.id !== name; });
    document.querySelectorAll('[data-view].is-active, .nav-list [data-view]').forEach((link) => {
      link.classList.toggle('is-active', link.dataset.view === name && !!link.closest('.nav-list'));
    });
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
      document.getElementById('applicantName').textContent = `${applicant.surname}, ${applicant.otherNames}`;
      document.getElementById('applicantNameDetail').textContent = `${applicant.surname}, ${applicant.otherNames}`;
      document.getElementById('applicantEmail').textContent = applicant.email || 'Not provided';
      document.getElementById('applicantPhone').textContent = applicant.phone || 'Not provided';
      document.getElementById('applicantNationality').textContent = applicant.nationality || 'Not provided';
      document.getElementById('applicantDob').textContent = applicant.dateOfBirth ? new Date(`${applicant.dateOfBirth}T00:00:00`).toLocaleDateString() : 'Not provided';
      document.getElementById('verificationStatus').textContent = applicant.isVerified ? 'Account verified' : 'Pending verification';
      dashboardContent.hidden = false;
      const initials = `${applicant.otherNames || ''}`.trim().charAt(0) + `${applicant.surname || ''}`.trim().charAt(0);
      document.getElementById('applicantInitials').textContent = initials.toUpperCase();
      document.getElementById('statAccount').textContent = applicant.isVerified ? 'Verified' : 'Pending';
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
