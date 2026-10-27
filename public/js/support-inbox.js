'use strict';

(() => {
  const listNode = document.getElementById('support-conversation-list');
  const messagesNode = document.getElementById('support-messages');
  const detailNode = document.getElementById('support-detail');
  const emptyNode = document.getElementById('support-empty');
  const shell = document.querySelector('.support-inbox-shell');
  const titleNode = document.getElementById('support-conversation-title');
  const infoNode = document.getElementById('support-conversation-info');
  const statusNode = document.getElementById('support-inbox-status');
  const replyForm = document.getElementById('support-reply-form');
  const claimButton = document.getElementById('support-claim');
  const closeButton = document.getElementById('support-close');
  const logoutButton = document.getElementById('support-logout');
  let csrfToken = '';
  let activeId = '';
  let busy = false;

  async function loadCsrfToken() {
    const response = await fetch('/api/support/csrf');
    const payload = await response.json();
    if (!response.ok || !payload.ok) throw new Error('Your support session has expired. Sign in again.');
    csrfToken = payload.data.token;
  }

  async function api(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (options.body) headers['Content-Type'] = 'application/json';
    if (options.method && options.method !== 'GET') {
      if (!csrfToken) await loadCsrfToken();
      headers['X-CSRF-Token'] = csrfToken;
    }
    const response = await fetch(`/api/support${path}`, { ...options, headers });
    const payload = await response.json();
    if (response.status === 403) csrfToken = '';
    if (response.status === 401) window.location.assign('/support/login');
    if (!response.ok || !payload.ok) throw new Error(payload.error?.message || 'The request could not be completed.');
    return payload.data;
  }

  function setStatus(message, isError = false) {
    statusNode.textContent = message;
    statusNode.classList.toggle('is-error', isError);
  }

  function renderMessage(message) {
    const item = document.createElement('article');
    item.className = `support-message support-message-${message.sender}`;
    const label = document.createElement('strong');
    label.textContent = {
      applicant: 'Applicant',
      assistant: 'EAIMS assistant',
      support: 'Support agent',
      system: 'System update',
    }[message.sender] || 'Message';
    const content = document.createElement('p');
    content.textContent = message.content;
    item.append(label, content);
    messagesNode.appendChild(item);
  }

  function renderList(items) {
    listNode.replaceChildren();
    if (!items.length) {
      const empty = document.createElement('p');
      empty.className = 'support-empty';
      empty.textContent = 'There are no open conversations.';
      listNode.appendChild(empty);
      activeId = '';
      detailNode.hidden = true;
      emptyNode.hidden = false;
      return;
    }
    items.forEach((item) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'support-conversation-item';
      button.classList.toggle('is-active', item.id === activeId);
      const name = [item.otherNames, item.surname].filter(Boolean).join(' ') || 'Guest applicant';
      const heading = document.createElement('strong');
      heading.textContent = name;
      const preview = document.createElement('span');
      preview.textContent = item.latestMessage || 'No messages';
      const badge = document.createElement('span');
      badge.className = `support-status support-status-${item.status}`;
      badge.textContent = item.status === 'pending_human' ? 'Waiting' : 'In progress';
      button.append(heading, preview, badge);
      button.addEventListener('click', () => {
        activeId = item.id;
        refreshInbox().catch((error) => setStatus(error.message, true));
      });
      listNode.appendChild(button);
    });
  }

  async function refreshInbox() {
    const data = await api('/conversations');
    renderList(data.conversations);
    if (!activeId) {
      detailNode.hidden = true;
      emptyNode.hidden = false;
      return;
    }
    const selected = data.conversations.find((item) => item.id === activeId);
    if (!selected) {
      activeId = '';
      detailNode.hidden = true;
      emptyNode.hidden = false;
      return;
    }
    emptyNode.hidden = true;
    detailNode.hidden = false;
    titleNode.textContent = [selected.otherNames, selected.surname].filter(Boolean).join(' ') || 'Guest applicant';
    infoNode.textContent = [
      selected.applicantEmail,
      selected.applicationNumber ? `Application ${selected.applicationNumber}` : '',
      selected.assignedAgentEmail ? `Assigned to ${selected.assignedAgentEmail}` : 'Unassigned',
    ].filter(Boolean).join(' · ');
    const conversation = await api(`/conversations/${encodeURIComponent(activeId)}`);
    messagesNode.replaceChildren();
    conversation.messages.forEach(renderMessage);
    const assignedToOther = selected.assignedAgentId != null
      && selected.assignedAgentId !== Number(shell.dataset.agentId);
    claimButton.hidden = Boolean(selected.assignedAgentId);
    replyForm.hidden = assignedToOther;
    closeButton.hidden = assignedToOther;
    if (assignedToOther) setStatus('Another support agent is handling this conversation.');
    else setStatus('');
    messagesNode.scrollTop = messagesNode.scrollHeight;
  }

  replyForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const field = replyForm.elements.message;
    const message = field.value.trim();
    if (!activeId || !message || busy) return;
    busy = true;
    setStatus('Sending reply...');
    try {
      await api(`/conversations/${encodeURIComponent(activeId)}/replies`, {
        method: 'POST',
        body: JSON.stringify({ message }),
      });
      field.value = '';
      await refreshInbox();
    } catch (error) {
      setStatus(error.message, true);
    } finally {
      busy = false;
    }
  });

  claimButton.addEventListener('click', async () => {
    if (!activeId || busy) return;
    busy = true;
    try {
      await api(`/conversations/${encodeURIComponent(activeId)}/claim`, { method: 'POST' });
      await refreshInbox();
    } catch (error) {
      setStatus(error.message, true);
    } finally {
      busy = false;
    }
  });

  closeButton.addEventListener('click', async () => {
    if (!activeId || busy) return;
    busy = true;
    try {
      await api(`/conversations/${encodeURIComponent(activeId)}/close`, { method: 'POST' });
      activeId = '';
      await refreshInbox();
    } catch (error) {
      setStatus(error.message, true);
    } finally {
      busy = false;
    }
  });

  logoutButton.addEventListener('click', async () => {
    try {
      await api('/logout', { method: 'POST' });
      window.location.assign('/support/login');
    } catch (error) {
      setStatus(error.message, true);
    }
  });

  api('/me')
    .then(({ agent }) => {
      shell.dataset.agentId = String(agent.id);
      return refreshInbox();
    })
    .catch((error) => setStatus(error.message, true));
  window.setInterval(() => refreshInbox().catch((error) => setStatus(error.message, true)), 30000);
})();
