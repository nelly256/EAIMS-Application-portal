'use strict';

(function () {
  const request = window.EaimsAdmin.request;
  const titles = {
    dashboard: 'Overview',
    intakes: 'Intake management',
    programs: 'Programme management',
    applicants: 'Applicants',
    applications: 'Applications',
    announcements: 'Announcements',
    reports: 'Reports & analytics',
    staff: 'Staff & audit',
  };
  const statusLabels = {
    submitted: 'Submitted',
    in_review: 'In review',
    approved: 'Approved',
    admitted: 'Admitted',
  };
  const statusOrder = Object.keys(statusLabels);
  let currentAdmin;
  let intakes = [];
  let programs = [];
  let editingProgramId = '';
  let editingIntakeName = '';

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function cell(text) {
    const node = el('td');
    node.textContent = text == null || text === '' ? '—' : String(text);
    return node;
  }

  function emptyRow(body, columns, text) {
    const row = el('tr');
    const cellNode = el('td', 'admin-empty', text);
    cellNode.colSpan = columns;
    row.appendChild(cellNode);
    body.replaceChildren(row);
  }

  function showMessage(message, success = false) {
    const node = document.getElementById('adminGlobalMessage');
    node.textContent = message || '';
    node.hidden = !message;
    node.classList.toggle('is-success', success);
  }

  async function runAction(action, successMessage) {
    showMessage('');
    try {
      await action();
      showMessage(successMessage, true);
      return true;
    } catch (error) {
      if (error.status === 401) {
        window.location.assign('/admin/login');
        return false;
      }
      showMessage(error.message);
      return false;
    }
  }

  function badge(label, state) {
    return el('span', `admin-badge${state ? ` is-${state}` : ''}`, label);
  }

  function actionButton(label, handler, className = '') {
    const button = el('button', `admin-button${className ? ` ${className}` : ''}`, label);
    button.type = 'button';
    button.addEventListener('click', handler);
    return button;
  }

  function formatDate(value) {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
  }

  function setView(name) {
    if (name === 'staff' && currentAdmin.role !== 'superadmin') return;
    document.querySelectorAll('.admin-view').forEach((panel) => {
      const active = panel.dataset.panel === name;
      panel.classList.toggle('is-active', active);
      panel.hidden = !active;
    });
    document.querySelectorAll('.admin-nav-link').forEach((button) => {
      button.classList.toggle('is-active', button.dataset.view === name);
    });
    document.getElementById('adminPageTitle').textContent = titles[name] || 'Administration';
    if (name === 'dashboard') void loadDashboard();
    if (name === 'intakes' || name === 'programs') void loadProgramsAndIntakes();
    if (name === 'applicants') void loadApplicants();
    if (name === 'applications') void loadApplications();
    if (name === 'announcements') void loadAnnouncements();
    if (name === 'staff') {
      void loadStaff();
      void loadAudit();
    }
  }

  function chartBarRow(label, value, maximum, color, unit) {
    const count = Number(value) || 0;
    const scale = Math.max(Number(maximum) || 0, 1);
    const row = el('div', 'admin-chart-bar-row');
    row.appendChild(el('span', 'admin-chart-bar-label', label));

    const track = el('div', 'admin-chart-track');
    track.setAttribute('role', 'progressbar');
    track.setAttribute('aria-label', `${label} ${unit}`);
    track.setAttribute('aria-valuemin', '0');
    track.setAttribute('aria-valuemax', String(scale));
    track.setAttribute('aria-valuenow', String(Math.min(count, scale)));
    track.setAttribute('aria-valuetext', `${count.toLocaleString()} ${unit}`);
    const fill = el('span', `admin-chart-fill ${color}`);
    fill.style.width = `${Math.min((count / scale) * 100, 100)}%`;
    track.appendChild(fill);
    row.append(track, el('strong', 'admin-chart-value', count.toLocaleString()));
    return row;
  }

  function renderProgrammeDemandChart(programmeDemand) {
    const chart = document.getElementById('programmeDemandChart');
    chart.replaceChildren();
    const topPrograms = programmeDemand
      .filter((program) => Number(program.selections) > 0 || Number(program.submissions) > 0)
      .slice(0, 6);
    const maximum = Math.max(
      0,
      ...topPrograms.flatMap((program) => [
        Number(program.selections) || 0,
        Number(program.submissions) || 0,
      ]),
    );
    if (maximum === 0) {
      chart.appendChild(el('p', 'admin-chart-empty', 'No programme selections have been recorded.'));
      return;
    }

    for (const program of topPrograms) {
      const item = el('div', 'admin-demand-chart-item');
      item.setAttribute('role', 'listitem');
      item.appendChild(el('p', 'admin-demand-chart-name', program.name));
      item.append(
        chartBarRow('Selections', program.selections, maximum, 'is-selections', 'selections'),
        chartBarRow('Submissions', program.submissions, maximum, 'is-submissions', 'submissions'),
      );
      chart.appendChild(item);
    }
  }

  function renderApplicationStatusChart(applicationStatuses) {
    const chart = document.getElementById('statusChart');
    chart.replaceChildren();
    const statusCounts = statusOrder.map((status) => ({
      status,
      label: statusLabels[status],
      count: Number(applicationStatuses[status]) || 0,
    }));
    const total = statusCounts.reduce((sum, item) => sum + item.count, 0);
    if (total === 0) {
      chart.appendChild(el('p', 'admin-chart-empty', 'No submitted applications have a status yet.'));
      return;
    }

    for (const item of statusCounts) {
      const row = el('div', 'admin-status-chart-item');
      row.setAttribute('role', 'listitem');
      row.appendChild(chartBarRow(item.label, item.count, total, `is-${item.status}`, 'applications'));
      chart.appendChild(row);
    }
  }

  async function loadDashboard() {
    try {
      const { data } = await request('/api/admin/dashboard');
      document.getElementById('metricRegistrations').textContent = data.registrations;
      document.getElementById('metricVerified').textContent = data.verifiedApplicants;
      document.getElementById('metricSubmissions').textContent = data.submittedApplications;
      document.getElementById('metricIncomplete').textContent = data.incompleteApplications;
      document.getElementById('metricFailures').textContent = data.failedSubmissionAttempts;
      document.getElementById('metricIntakes').textContent = data.openIntakes;
      document.getElementById('metricPrograms').textContent = data.activePrograms;

      const demandBody = document.getElementById('demandTable');
      demandBody.replaceChildren();
      if (!data.programmeDemand.length) emptyRow(demandBody, 3, 'No programme selections have been recorded.');
      data.programmeDemand.forEach((program) => {
        const row = el('tr');
        row.append(cell(program.name), cell(program.selections), cell(program.submissions || 0));
        demandBody.appendChild(row);
      });
      renderProgrammeDemandChart(data.programmeDemand);
      renderApplicationStatusChart(data.applicationStatuses);
    } catch (error) {
      if (error.status === 401) window.location.assign('/admin/login');
      else showMessage(error.message);
    }
  }

  async function loadProgramsAndIntakes() {
    try {
      const [programPayload, intakePayload] = await Promise.all([
        request('/api/admin/programs'),
        request('/api/admin/intakes'),
      ]);
      programs = programPayload.data.programs;
      intakes = intakePayload.data.intakes;
      renderIntakes();
      renderPrograms();
      renderProgramIntakeChoices();
    } catch (error) {
      if (error.status === 401) window.location.assign('/admin/login');
      else showMessage(error.message);
    }
  }

  function renderIntakes() {
    const body = document.getElementById('intakesTable');
    body.replaceChildren();
    if (!intakes.length) return emptyRow(body, 5, 'No intake periods are configured.');
    intakes.forEach((intake) => {
      const row = el('tr');
      row.append(
        cell(intake.name),
        cell([intake.openingDate, intake.closingDate].filter(Boolean).join(' to ') || 'No date window'),
        cell(intake.availablePrograms),
      );
      const status = el('td');
      status.appendChild(badge(intake.isOpen ? 'Open' : 'Closed', intake.isOpen ? 'active' : 'warning'));
      row.appendChild(status);
      const actions = el('td');
      const group = el('div', 'admin-table-actions');
      group.appendChild(actionButton('Edit', () => editIntake(intake)));
      group.appendChild(actionButton(intake.isOpen ? 'Close' : 'Open', () => {
        void runAction(async () => {
          await request(`/api/admin/intakes/${encodeURIComponent(intake.name)}`, {
            method: 'PATCH',
            body: JSON.stringify({ isOpen: !intake.isOpen }),
          });
          await loadProgramsAndIntakes();
        }, `Intake ${intake.name} is now ${intake.isOpen ? 'closed' : 'open'}.`);
      }));
      actions.appendChild(group);
      row.appendChild(actions);
      body.appendChild(row);
    });
  }

  function editIntake(intake) {
    editingIntakeName = intake.name;
    const form = document.getElementById('intakeForm');
    form.elements.name.value = intake.name;
    form.elements.name.readOnly = true;
    form.elements.openingDate.value = intake.openingDate || '';
    form.elements.closingDate.value = intake.closingDate || '';
    form.elements.isOpen.checked = intake.isOpen;
    document.getElementById('intakeFormTitle').textContent = `Edit ${intake.name}`;
    form.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function resetIntakeForm() {
    editingIntakeName = '';
    const form = document.getElementById('intakeForm');
    form.elements.name.readOnly = false;
    form.elements.isOpen.checked = true;
    document.getElementById('intakeFormTitle').textContent = 'Create intake';
  }

  function renderProgramIntakeChoices(selected = []) {
    const target = document.getElementById('programIntakeChoices');
    target.replaceChildren();
    if (!intakes.length) {
      target.appendChild(el('p', 'admin-empty', 'Create an intake before assigning programme availability.'));
      return;
    }
    intakes.forEach((intake) => {
      const label = el('label');
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.name = 'intakes';
      input.value = intake.name;
      input.checked = selected.includes(intake.name);
      label.append(input, document.createTextNode(`${intake.name}${intake.isOpen ? '' : ' (closed)'}`));
      target.appendChild(label);
    });
  }

  function renderPrograms() {
    const body = document.getElementById('programsTable');
    body.replaceChildren();
    if (!programs.length) return emptyRow(body, 6, 'No programmes are configured.');
    programs.forEach((program) => {
      const row = el('tr');
      const programCell = el('td');
      programCell.appendChild(el('strong', '', program.name));
      if (program.eligibility) programCell.appendChild(el('small', '', program.eligibility));
      row.append(programCell, cell(program.level), cell(program.duration));
      row.appendChild(cell(program.intakes.filter((intake) => intake.available).map((intake) => intake.name).join(', ')));
      const statusCell = el('td');
      statusCell.appendChild(badge(program.isActive ? 'Active' : 'Inactive', program.isActive ? 'active' : 'warning'));
      row.appendChild(statusCell);
      const actions = el('td');
      const group = el('div', 'admin-table-actions');
      group.appendChild(actionButton('Edit', () => editProgram(program)));
      if (program.isActive) {
        group.appendChild(actionButton('Deactivate', () => {
          void runAction(async () => {
            await request(`/api/admin/programs/${encodeURIComponent(program.id)}/deactivate`, { method: 'POST', body: '{}' });
            await loadProgramsAndIntakes();
          }, `${program.name} was deactivated.`);
        }));
      }
      actions.appendChild(group);
      row.appendChild(actions);
      body.appendChild(row);
    });
  }

  function editProgram(program) {
    editingProgramId = program.id;
    const form = document.getElementById('programForm');
    form.elements.level.value = program.level;
    form.elements.name.value = program.name;
    form.elements.duration.value = program.duration;
    form.elements.tuition.value = program.tuition;
    form.elements.eligibility.value = program.eligibility;
    form.elements.isActive.checked = program.isActive;
    renderProgramIntakeChoices(program.intakes.filter((intake) => intake.available).map((intake) => intake.name));
    document.getElementById('programFormTitle').textContent = `Edit ${program.name}`;
    form.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function resetProgramForm() {
    editingProgramId = '';
    document.getElementById('programFormTitle').textContent = 'Add programme';
    document.getElementById('programForm').elements.isActive.checked = true;
    renderProgramIntakeChoices();
  }

  async function loadApplicants(search = '', status = '') {
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (status) params.set('status', status);
      const payload = await request(`/api/admin/applicants?${params.toString()}`);
      const body = document.getElementById('applicantsTable');
      body.replaceChildren();
      if (!payload.data.applicants.length) return emptyRow(body, 6, 'No matching applicants were found.');
      payload.data.applicants.forEach((applicant) => {
        const row = el('tr');
        const person = el('td');
        person.appendChild(el('strong', '', `${applicant.first_name || applicant.otherNames} ${applicant.last_name || applicant.surname}`));
        person.appendChild(el('small', '', applicant.email || applicant.phone || 'No contact details'));
        row.appendChild(person);
        row.append(cell(applicant.applicationNumber));
        const verifiedCell = el('td');
        verifiedCell.appendChild(badge(applicant.isVerified ? 'Verified' : 'Unverified', applicant.isVerified ? 'active' : 'warning'));
        row.appendChild(verifiedCell);
        const statusCell = el('td');
        statusCell.appendChild(badge(
          applicant.applicationStatus ? statusLabels[applicant.applicationStatus] : applicant.isIncomplete ? 'Incomplete' : 'In progress',
          applicant.applicationStatus ? 'active' : applicant.isIncomplete ? 'warning' : '',
        ));
        row.appendChild(statusCell);
        row.append(cell(formatDate(applicant.registeredAt)));
        const actions = el('td');
        actions.appendChild(actionButton('View record', () => void loadApplicantDetail(applicant.id, 'applicants')));
        row.appendChild(actions);
        body.appendChild(row);
      });
    } catch (error) {
      if (error.status === 401) window.location.assign('/admin/login');
      else showMessage(error.message);
    }
  }

  function appendRecordField(dl, label, value) {
    const wrapper = el('div');
    wrapper.append(el('dt', '', label), el('dd', '', value || 'Not provided'));
    dl.appendChild(wrapper);
  }

  async function loadApplicantDetail(applicantId, mode) {
    const isApplication = mode === 'applications';
    const panel = document.getElementById(isApplication ? 'applicationDetailPanel' : 'applicantDetailPanel');
    const content = document.getElementById(isApplication ? 'applicationDetail' : 'applicantDetail');
    try {
      const { data } = await request(`/api/admin/applicants/${applicantId}`);
      const { applicant, profile, submission, programSelection, documents } = data;
      const title = [profile?.first_name || applicant.otherNames, profile?.last_name || applicant.surname].filter(Boolean).join(' ');
      document.getElementById(isApplication ? 'applicationDetailTitle' : 'applicantDetailTitle').textContent = title || applicant.applicationNumber;
      document.getElementById(isApplication ? 'applicationDetailSubtitle' : 'applicantDetailSubtitle').textContent =
        `${applicant.applicationNumber || 'No application number'} · ${applicant.email || applicant.phone || 'No contact details'}`;
      content.replaceChildren();
      const grid = el('dl', 'admin-record-grid');
      appendRecordField(grid, 'Email', applicant.email);
      appendRecordField(grid, 'Phone', applicant.phone);
      appendRecordField(grid, 'Account verification', applicant.isVerified ? 'Verified' : 'Not verified');
      appendRecordField(grid, 'Account access', applicant.isActive ? 'Active' : 'Deactivated');
      appendRecordField(grid, 'Date of birth', profile?.date_of_birth || applicant.dateOfBirth);
      appendRecordField(grid, 'Gender', profile?.gender || applicant.sex);
      appendRecordField(grid, 'ID / passport', profile?.id_number);
      appendRecordField(grid, 'Country of birth', profile?.country_of_birth);
      appendRecordField(grid, 'Address', profile?.physical_address);
      appendRecordField(grid, 'Sponsor/guardian', profile?.next_of_kin_name);
      appendRecordField(grid, 'Sponsor/guardian contact', profile?.next_of_kin_contact);
      appendRecordField(grid, 'Programme', programSelection?.name);
      appendRecordField(grid, 'Intake', programSelection?.intake);
      appendRecordField(grid, 'Registered', formatDate(applicant.registeredAt));
      content.appendChild(grid);

      const docHeading = el('h3', '', 'Supporting documents');
      content.appendChild(docHeading);
      const docList = el('div', 'admin-document-list');
      if (profile?.has_passport_photo) {
        const photo = el('span', 'admin-badge is-active', 'Passport photo on file');
        docList.appendChild(photo);
      }
      documents.forEach((document) => {
        const link = el('a', 'admin-document-link', `${document.category}: ${document.original_name}`);
        link.href = `/api/admin/applicants/${applicant.id}/documents/${document.id}`;
        link.download = document.original_name;
        docList.appendChild(link);
      });
      if (!docList.childElementCount) docList.appendChild(el('span', 'admin-empty', 'No supporting documents uploaded.'));
      content.appendChild(docList);
      const actions = el('div', 'admin-record-actions');
      if (currentAdmin.role !== 'reviewer') {
        actions.appendChild(actionButton(applicant.isActive ? 'Deactivate account' : 'Reactivate account', () => {
          void runAction(async () => {
            await request(`/api/admin/applicants/${applicant.id}/account`, {
              method: 'PATCH',
              body: JSON.stringify({ isActive: !applicant.isActive }),
            });
            await loadApplicantDetail(applicant.id, mode);
            await loadApplicants();
          }, `Applicant account ${applicant.isActive ? 'deactivated' : 'reactivated'}.`);
        }));
      }
      content.appendChild(actions);

      if (isApplication) {
        content.appendChild(el('h3', '', 'Submission review'));
        const missing = data.missingItems || [];
        content.appendChild(el('p', '', submission
          ? `Submitted ${formatDate(submission.submittedAt)}.`
          : `${data.failedSubmissionAttempts ? `${data.failedSubmissionAttempts} failed submission attempt(s); latest ${formatDate(data.lastSubmissionFailureAt)}. ` : ''}Not submitted. Incomplete items: ${missing.join(', ') || 'None identified'}.`));
        if (submission) {
          const form = document.createElement('form');
          form.className = 'admin-record-actions';
          const statusSelect = document.createElement('select');
          statusSelect.setAttribute('aria-label', 'Application status');
          const currentIndex = statusOrder.indexOf(submission.status);
          statusOrder.slice(Math.max(0, currentIndex)).forEach((status) => {
            const option = document.createElement('option');
            option.value = status;
            option.textContent = statusLabels[status];
            option.selected = status === submission.status;
            statusSelect.appendChild(option);
          });
          const saveStatus = el('button', 'admin-button admin-button-primary', 'Save status');
          saveStatus.type = 'submit';
          form.append(statusSelect, saveStatus);
          form.addEventListener('submit', (event) => {
            event.preventDefault();
            void runAction(async () => {
              await request(`/api/admin/applications/${applicant.id}/status`, {
                method: 'PATCH',
                body: JSON.stringify({ status: statusSelect.value }),
              });
              await loadApplicantDetail(applicant.id, mode);
              await loadApplications();
            }, 'Application status updated.');
          });
          content.appendChild(form);
        }
      }
      panel.hidden = false;
      panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (error) {
      if (error.status === 401) window.location.assign('/admin/login');
      else showMessage(error.message);
    }
  }

  async function loadApplications(search = '', status = '') {
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (status) params.set('status', status);
      const { data } = await request(`/api/admin/applications?${params.toString()}`);
      const body = document.getElementById('applicationsTable');
      body.replaceChildren();
      if (!data.applications.length) return emptyRow(body, 6, 'No matching applications were found.');
      data.applications.forEach((application) => {
        const row = el('tr');
        const person = el('td');
        person.appendChild(el('strong', '', `${application.first_name || application.otherNames} ${application.last_name || application.surname}`));
        person.appendChild(el('small', '', application.applicationNumber || 'No reference'));
        row.appendChild(person);
        row.append(cell([application.programName, application.intake].filter(Boolean).join(' · ')));
        const statusCell = el('td');
        statusCell.appendChild(badge(
          application.applicationStatus
            ? statusLabels[application.applicationStatus]
            : application.isFailed ? 'Failed attempt' : application.isIncomplete ? 'Incomplete' : 'Not submitted',
          application.applicationStatus ? 'active' : application.isFailed || application.isIncomplete ? 'warning' : '',
        ));
        row.appendChild(statusCell);
        row.append(cell([
          application.hasPassportPhoto ? 'Photo' : 'No photo',
          application.hasTranscript ? 'Transcript' : 'No transcript',
          application.hasIdentity ? 'ID' : 'No ID',
        ].join(', ')));
        row.append(cell(formatDate(application.submittedAt)));
        const review = el('td');
        review.appendChild(actionButton('Review', () => void loadApplicantDetail(application.id, 'applications')));
        row.appendChild(review);
        body.appendChild(row);
      });
    } catch (error) {
      if (error.status === 401) window.location.assign('/admin/login');
      else showMessage(error.message);
    }
  }

  async function loadAnnouncements() {
    try {
      const { data } = await request('/api/admin/announcements');
      const container = document.getElementById('announcementsList');
      container.replaceChildren();
      if (!data.announcements.length) {
        container.appendChild(el('p', 'admin-empty', 'There are no announcements yet.'));
        return;
      }
      data.announcements.forEach((announcement) => {
        const card = el('article', 'admin-announcement-card');
        const heading = el('div', 'admin-panel-heading');
        heading.append(el('h2', '', announcement.title), badge(announcement.isPublished ? 'Published' : 'Unpublished', announcement.isPublished ? 'active' : 'warning'));
        const body = el('p', '', announcement.body);
        const date = el('time', '', formatDate(announcement.createdAt));
        const toggle = actionButton(announcement.isPublished ? 'Unpublish' : 'Publish', () => {
          void runAction(async () => {
            await request(`/api/admin/announcements/${announcement.id}`, {
              method: 'PATCH',
              body: JSON.stringify({ isPublished: !announcement.isPublished }),
            });
            await loadAnnouncements();
          }, announcement.isPublished ? 'Announcement unpublished.' : 'Announcement published.');
        });
        card.append(heading, body, date, toggle);
        container.appendChild(card);
      });
    } catch (error) {
      if (error.status === 401) window.location.assign('/admin/login');
      else showMessage(error.message);
    }
  }

  async function loadStaff() {
    try {
      const { data } = await request('/api/admin/staff');
      const body = document.getElementById('staffTable');
      body.replaceChildren();
      if (!data.staff.length) return emptyRow(body, 5, 'No staff accounts are configured.');
      data.staff.forEach((staff) => {
        const row = el('tr');
        row.append(cell(staff.email));
        const roleCell = el('td');
        const roleSelect = document.createElement('select');
        roleSelect.setAttribute('aria-label', `Role for ${staff.email}`);
        ['superadmin', 'admin', 'reviewer'].forEach((role) => {
          const option = document.createElement('option');
          option.value = role;
          option.textContent = role === 'superadmin' ? 'Superadministrator' : role === 'admin' ? 'Administrator' : 'Reviewer';
          option.selected = staff.role === role;
          roleSelect.appendChild(option);
        });
        roleCell.appendChild(roleSelect);
        row.appendChild(roleCell);
        const statusCell = el('td');
        statusCell.appendChild(badge(staff.isActive ? 'Active' : 'Inactive', staff.isActive ? 'active' : 'danger'));
        row.appendChild(statusCell);
        row.append(cell(formatDate(staff.lastLoginAt)));
        const actions = el('td');
        const group = el('div', 'admin-table-actions');
        const saveRole = actionButton('Save role', () => {
          void runAction(async () => {
            await request(`/api/admin/staff/${staff.id}`, {
              method: 'PATCH',
              body: JSON.stringify({ role: roleSelect.value }),
            });
            await loadStaff();
            await loadAudit();
          }, 'Staff role updated.');
        });
        group.appendChild(saveRole);
        if (staff.id !== currentAdmin.id) {
          group.appendChild(actionButton(staff.isActive ? 'Deactivate' : 'Activate', () => {
            void runAction(async () => {
              await request(`/api/admin/staff/${staff.id}`, {
                method: 'PATCH',
                body: JSON.stringify({ isActive: !staff.isActive }),
              });
              await loadStaff();
              await loadAudit();
            }, `Staff account ${staff.isActive ? 'deactivated' : 'activated'}.`);
          }));
        }
        actions.appendChild(group);
        row.appendChild(actions);
        body.appendChild(row);
      });
    } catch (error) {
      if (error.status === 401) window.location.assign('/admin/login');
      else showMessage(error.message);
    }
  }

  async function loadAudit() {
    try {
      const { data } = await request('/api/admin/audit-logs?limit=100');
      const body = document.getElementById('auditTable');
      body.replaceChildren();
      if (!data.logs.length) return emptyRow(body, 5, 'No administrative activity has been recorded.');
      data.logs.forEach((log) => {
        const row = el('tr');
        row.append(cell(formatDate(log.createdAt)), cell(log.adminEmail || 'Former staff'), cell(log.action), cell(`${log.entityType}${log.entityId ? ` · ${log.entityId}` : ''}`), cell(JSON.stringify(log.details)));
        body.appendChild(row);
      });
    } catch (error) {
      if (error.status === 401) window.location.assign('/admin/login');
      else showMessage(error.message);
    }
  }

  document.querySelectorAll('.admin-nav-link').forEach((button) => {
    button.addEventListener('click', () => setView(button.dataset.view));
  });
  document.querySelectorAll('[data-refresh]').forEach((button) => button.addEventListener('click', () => void loadDashboard()));
  document.querySelectorAll('[data-close-applicant]').forEach((button) => button.addEventListener('click', () => {
    document.getElementById('applicantDetailPanel').hidden = true;
    document.getElementById('applicationDetailPanel').hidden = true;
  }));
  document.querySelector('[data-refresh-audit]').addEventListener('click', () => void loadAudit());

  document.getElementById('intakeForm').addEventListener('submit', (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const body = {
      name: form.elements.name.value,
      openingDate: form.elements.openingDate.value,
      closingDate: form.elements.closingDate.value,
      isOpen: form.elements.isOpen.checked,
    };
    void runAction(async () => {
      await request(editingIntakeName
        ? `/api/admin/intakes/${encodeURIComponent(editingIntakeName)}`
        : '/api/admin/intakes', {
        method: editingIntakeName ? 'PATCH' : 'POST',
        body: JSON.stringify(body),
      });
      form.reset();
      resetIntakeForm();
      await loadProgramsAndIntakes();
    }, 'Intake saved.');
  });
  document.getElementById('intakeForm').addEventListener('reset', () => setTimeout(resetIntakeForm, 0));
  document.getElementById('resetIntakeForm').addEventListener('click', resetIntakeForm);

  document.getElementById('programForm').addEventListener('submit', (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const body = {
      level: form.elements.level.value,
      name: form.elements.name.value,
      duration: form.elements.duration.value,
      tuition: form.elements.tuition.value,
      eligibility: form.elements.eligibility.value,
      isActive: form.elements.isActive.checked,
      intakes: Array.from(form.querySelectorAll('input[name="intakes"]:checked'), (input) => input.value),
    };
    void runAction(async () => {
      await request(editingProgramId
        ? `/api/admin/programs/${encodeURIComponent(editingProgramId)}`
        : '/api/admin/programs', {
        method: editingProgramId ? 'PATCH' : 'POST',
        body: JSON.stringify(body),
      });
      form.reset();
      resetProgramForm();
      await loadProgramsAndIntakes();
    }, 'Programme saved.');
  });
  document.getElementById('programForm').addEventListener('reset', () => setTimeout(resetProgramForm, 0));
  document.getElementById('resetProgramForm').addEventListener('click', resetProgramForm);

  document.getElementById('applicantSearchForm').addEventListener('submit', (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    void loadApplicants(form.elements.search.value, form.elements.status.value);
  });
  document.getElementById('applicationSearchForm').addEventListener('submit', (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    void loadApplications(form.elements.search.value, form.elements.status.value);
  });
  document.getElementById('announcementForm').addEventListener('submit', (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    void runAction(async () => {
      await request('/api/admin/announcements', {
        method: 'POST',
        body: JSON.stringify({ title: form.elements.title.value, body: form.elements.body.value }),
      });
      form.reset();
      await loadAnnouncements();
    }, 'Announcement published to applicant dashboards.');
  });
  document.querySelectorAll('[data-report]').forEach((button) => {
    button.addEventListener('click', () => void runAction(
      () => window.EaimsAdmin.download(`/api/admin/reports/${button.dataset.report}.csv`),
      'Report downloaded.',
    ));
  });
  document.getElementById('staffForm').addEventListener('submit', (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    void runAction(async () => {
      await request('/api/admin/staff', {
        method: 'POST',
        body: JSON.stringify({
          email: form.elements.email.value,
          password: form.elements.password.value,
          role: form.elements.role.value,
        }),
      });
      form.reset();
      await loadStaff();
      await loadAudit();
    }, 'Staff account created.');
  });
  document.getElementById('adminLogoutButton').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const { data } = await request('/api/admin/logout', { method: 'POST', body: '{}' });
      window.location.assign(data.redirect);
    } catch (error) {
      showMessage(error.message);
      button.disabled = false;
    }
  });

  async function initialize() {
    try {
      const { data } = await request('/api/admin/me');
      currentAdmin = data.admin;
      document.getElementById('adminUserEmail').textContent = currentAdmin.email;
      document.getElementById('adminUserRole').textContent = currentAdmin.role;
      document.getElementById('adminAvatar').textContent = currentAdmin.email.slice(0, 2).toUpperCase();
      if (currentAdmin.role === 'superadmin') {
        document.querySelector('[data-superadmin-only]').hidden = false;
      }
      if (currentAdmin.role === 'reviewer') {
        document.querySelectorAll('[data-admin-only]').forEach((link) => { link.hidden = true; });
      }
      setView('dashboard');
    } catch (error) {
      if (error.status === 401) window.location.assign('/admin/login');
      else showMessage(error.message);
    }
  }

  void initialize();
}());
