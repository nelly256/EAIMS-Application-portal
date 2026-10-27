'use strict';

(() => {
  if (document.getElementById('eaims-chat-widget')) return;

  const root = document.createElement('div');
  root.id = 'eaims-chat-widget';
  root.className = 'chat-widget';
  root.innerHTML = `
    <section class="chat-panel" id="eaims-chat-panel" aria-label="EAIMS admissions chat" hidden>
      <header class="chat-header">
        <div>
          <strong>EAIMS admissions help</strong>
          <span>Ask about programs and applying</span>
        </div>
        <button class="chat-close" type="button" aria-label="Close chat">×</button>
      </header>
      <div class="chat-messages" role="log" aria-live="polite" aria-relevant="additions"></div>
      <div class="chat-status" role="status"></div>
      <div class="chat-actions">
        <button class="chat-handoff" type="button">Talk to admissions</button>
      </div>
      <form class="chat-form">
        <label class="visually-hidden" for="eaims-chat-input">Your message</label>
        <textarea id="eaims-chat-input" name="message" maxlength="1000" rows="2" placeholder="Type your question..." required></textarea>
        <button type="submit">Send</button>
      </form>
      <p class="chat-privacy">When AI is enabled, messages may be processed by our AI provider. Never send passwords, verification codes, or payment details.</p>
    </section>
    <button class="chat-launcher" type="button" aria-label="Chat with Us" aria-expanded="false" aria-controls="eaims-chat-panel">
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path fill="#fff" d="M12 3.25c-5.23 0-9.47 3.38-9.47 7.55 0 2.08 1.14 3.96 2.98 5.32l-.67 3.34 4.12-2.05c.95.3 1.98.46 3.04.46 5.23 0 9.47-3.38 9.47-7.55S17.23 3.25 12 3.25Z" />
        <circle cx="8.1" cy="10.8" r="1.15" fill="#009344" />
        <circle cx="12" cy="10.8" r="1.15" fill="#009344" />
        <circle cx="15.9" cy="10.8" r="1.15" fill="#009344" />
      </svg>
      <span class="chat-launcher-label" aria-hidden="true">Chat with Us</span>
    </button>`;
  document.body.appendChild(root);

  const panel = root.querySelector('.chat-panel');
  const launcher = root.querySelector('.chat-launcher');
  const closeButton = root.querySelector('.chat-close');
  const messagesNode = root.querySelector('.chat-messages');
  const statusNode = root.querySelector('.chat-status');
  const form = root.querySelector('.chat-form');
  const input = root.querySelector('#eaims-chat-input');
  const handoffButton = root.querySelector('.chat-handoff');
  let csrfToken = '';
  let currentConversationId = '';
  let renderedMessageCount = 0;
  let pollTimer;
  let busy = false;

  function showStatus(message, isError = false) {
    statusNode.textContent = message;
    statusNode.classList.toggle('is-error', isError);
  }

  function appendMessage(message) {
    const item = document.createElement('div');
    item.className = `chat-message chat-message-${message.sender}`;
    const label = document.createElement('span');
    label.className = 'chat-message-label';
    label.textContent = {
      applicant: 'You',
      assistant: 'EAIMS assistant',
      support: 'Admissions support',
      system: 'Update',
    }[message.sender] || 'Message';
    const content = document.createElement('p');
    content.textContent = message.content;
    item.append(label, content);
    messagesNode.appendChild(item);
  }

  function renderConversation(conversation) {
    const nextId = conversation ? conversation.id : '';
    if (nextId !== currentConversationId) {
      messagesNode.replaceChildren();
      currentConversationId = nextId;
      renderedMessageCount = 0;
    }
    if (conversation && conversation.messages.length) {
      if (!renderedMessageCount) messagesNode.replaceChildren();
      conversation.messages.slice(renderedMessageCount).forEach(appendMessage);
      renderedMessageCount = conversation.messages.length;
    } else if (!renderedMessageCount && !messagesNode.querySelector('.chat-welcome')) {
      const welcome = document.createElement('p');
      welcome.className = 'chat-welcome';
      welcome.textContent = 'Hello! Ask us about the application process, study arrangements, intakes, or programs.';
      messagesNode.appendChild(welcome);
    }

    if (conversation && conversation.status === 'pending_human') {
      showStatus('Your conversation is waiting in the admissions support inbox.');
    } else if (conversation && conversation.status === 'in_progress') {
      showStatus('Admissions support is handling this conversation.');
    } else if (conversation && conversation.status === 'closed') {
      showStatus('This conversation is closed. Send a new message to start another.');
    } else {
      showStatus('');
    }
  }

  async function getCsrfToken() {
    const response = await fetch('/api/chat/csrf');
    const payload = await response.json();
    if (!response.ok || !payload.ok) throw new Error('Chat is temporarily unavailable. Please try again.');
    csrfToken = payload.data.token;
  }

  async function refreshConversation() {
    const response = await fetch('/api/chat/conversation');
    const payload = await response.json();
    if (!response.ok || !payload.ok) throw new Error('Chat is temporarily unavailable. Please try again.');
    renderConversation(payload.data);
  }

  async function post(path, body) {
    if (!csrfToken) await getCsrfToken();
    const response = await fetch(`/api/chat/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
      body: JSON.stringify(body || {}),
    });
    const payload = await response.json();
    if (response.status === 403) {
      csrfToken = '';
      await getCsrfToken();
    }
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error?.message || 'Unable to send your message. Please try again.');
    }
    renderConversation(payload.data);
  }

  function setOpen(open) {
    panel.hidden = !open;
    launcher.setAttribute('aria-expanded', String(open));
    if (open) {
      refreshConversation().catch((error) => showStatus(error.message, true));
      input.focus();
      pollTimer = window.setInterval(() => {
        refreshConversation().catch((error) => showStatus(error.message, true));
      }, 30000);
    } else {
      window.clearInterval(pollTimer);
    }
  }

  launcher.addEventListener('click', () => setOpen(panel.hidden));
  closeButton.addEventListener('click', () => setOpen(false));

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const message = input.value.trim();
    if (!message || busy) return;
    busy = true;
    form.querySelector('button[type="submit"]').disabled = true;
    showStatus('Sending...');
    try {
      await post('messages', { message });
      input.value = '';
    } catch (error) {
      showStatus(error.message, true);
    } finally {
      busy = false;
      form.querySelector('button[type="submit"]').disabled = false;
      input.focus();
    }
  });

  handoffButton.addEventListener('click', async () => {
    if (busy) return;
    busy = true;
    handoffButton.disabled = true;
    try {
      await post('handoff');
    } catch (error) {
      showStatus(error.message, true);
    } finally {
      busy = false;
      handoffButton.disabled = false;
    }
  });
})();
