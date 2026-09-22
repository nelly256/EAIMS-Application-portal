(function () {
  'use strict';

  const logoutButton = document.getElementById('logoutButton');
  const dashboardContent = document.getElementById('dashboardContent');
  const dashboardError = document.getElementById('dashboardError');

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
