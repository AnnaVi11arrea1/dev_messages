/* popup.js – Main application logic
 *
 * NOTE ON CROSS-USER MESSAGING:
 * All data is stored in chrome.storage.local (per Chrome profile).
 * In this implementation both users must share the same Chrome profile
 * (e.g., for testing / single-device use).  To support real cross-device
 * messaging, replace the Storage calls in sendFirstMessage / sendReply with
 * REST API calls to a backend, and poll / push-notify the recipient.
 */

'use strict';

/* ─── App state ────────────────────────────────────────────────────────────── */
let currentUser = null;   // { username, name, profileImage }
let activeConvId = null;  // currently open conversation
let pendingFlag = null;   // { convId, msgId } – waiting for reason selection
let foundUser = null;     // result of last user search
let pollTimer = null;     // setInterval handle for message polling

/* ─── Polling ──────────────────────────────────────────────────────────────── */
function startPolling(ms = 6000) {
  stopPolling();
  pollTimer = setInterval(async () => {
    if (!activeConvId) return;
    try {
      const conv = await Storage.getConversation(activeConvId);
      if (conv) renderMessages(conv);
    } catch { /* network hiccup – try again next tick */ }
  }, ms);
}

function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

/* ─── Helpers ──────────────────────────────────────────────────────────────── */
function qs(sel) { return document.querySelector(sel); }

function showView(id) {
  document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
  const el = document.getElementById(id);
  if (el) el.classList.add('active');
}

function showToast(msg, type = '') {
  const t = qs('#toast');
  t.textContent = msg;
  t.className = `toast${type ? ' ' + type : ''}`;
  t.classList.remove('hidden');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.add('hidden'), 2600);
}

function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60)    return 'just now';
  if (s < 3600)  return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 604800) return `${Math.floor(s / 86400)}d ago`;
  return new Date(ts).toLocaleDateString();
}

function defaultAvatar(username) {
  const initial = (username || '?')[0].toUpperCase();
  // Returns a tiny inline SVG data-URI as fallback
  return `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='40'%3E%3Crect width='40' height='40' rx='20' fill='%233b49df'/%3E%3Ctext x='50%25' y='55%25' text-anchor='middle' dominant-baseline='middle' fill='white' font-size='18' font-family='sans-serif'%3E${initial}%3C/text%3E%3C/svg%3E`;
}

/* ─── Init ─────────────────────────────────────────────────────────────────── */
async function init() {
  showView('view-loading');
  bindStaticListeners();

  /* Remove any conversations/messages left over from the old local-storage
     implementation so they can never trigger stale API lookups. */
  chrome.storage.local.remove('conversations');

  /* Check if the active tab is dev.to */
  let onDevTo = false;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    onDevTo = !!(tab && tab.url && tab.url.includes('dev.to'));
  } catch { /* tabs permission denied? treat as not on dev.to */ }

  /* Load current user from storage (set by content.js) */
  currentUser = await Storage.getCurrentUser();

  if (!currentUser) {
    showView('view-not-devto');
    return;
  }

  /* Give Storage access to the username for API auth headers */
  Storage.username = currentUser.username;

  /* Check for a pending "start new message" request from a content-script button */
  const { pendingNewMessageTo } = await Storage.get('pendingNewMessageTo');
  if (pendingNewMessageTo) {
    await Storage.set({ pendingNewMessageTo: null });
    const eligible = await checkEligibilityAndLoad(/* silent= */ true);
    if (eligible) {
      showView('view-new-message');
      qs('#user-search-input').value = pendingNewMessageTo;
      await searchUser();
    }
    return;
  }

  await checkEligibilityAndLoad();
}

/* Returns true if user is eligible; shows appropriate view otherwise */
async function checkEligibilityAndLoad(silent = false) {
  if (!silent) showView('view-loading');
  const result = await Eligibility.check(currentUser.username);

  if (result.error) {
    /* API unreachable – allow through with a warning */
    showToast('Could not verify eligibility. Proceeding.', '');
    await loadInbox();
    return true;
  }

  if (!result.eligible) {
    qs('#ineligible-user').textContent = `@${currentUser.username}`;
    const list = qs('#eligibility-reasons');
    list.innerHTML = `
      <div class="eligibility-item ${result.accountOldEnough ? 'pass' : 'fail'}">
        ${result.accountOldEnough ? '✓' : '✗'}
        Account age: <strong>${result.daysSince} / 30 days</strong>
      </div>
      <div class="eligibility-item ${result.hasPost ? 'pass' : 'fail'}">
        ${result.hasPost ? '✓' : '✗'}
        Published posts: <strong>${result.articlesCount} / 1 required</strong>
      </div>`;
    showView('view-not-eligible');
    return false;
  }

  /* Refresh stored profile data */
  currentUser = {
    ...currentUser,
    name: result.name || currentUser.name,
    profileImage: result.profileImage || currentUser.profileImage,
  };
  await Storage.setCurrentUser(currentUser);
  await loadInbox();
  return true;
}

/* ─── Static event listeners (bound once on init) ─────────────────────────── */
function bindStaticListeners() {
  /* Navigation */
  qs('#goto-devto-btn').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: 'https://dev.to' });
  });
  qs('#back-btn').addEventListener('click', loadInbox);
  qs('#new-msg-back-btn').addEventListener('click', loadInbox);
  qs('#new-message-btn').addEventListener('click', openNewMessageView);

  /* User search */
  qs('#user-search-btn').addEventListener('click', searchUser);
  qs('#user-search-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') searchUser();
  });
  qs('#send-first-btn').addEventListener('click', sendFirstMessage);

  /* Reply */
  qs('#send-btn').addEventListener('click', sendReply);
  qs('#message-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendReply(); }
  });

  /* Approval */
  qs('#approve-btn').addEventListener('click', () => handleApproval(true));
  qs('#deny-btn').addEventListener('click',    () => handleApproval(false));

  /* Link warning modal */
  qs('#link-cancel-btn').addEventListener('click', () =>
    qs('#modal-link-warning').classList.add('hidden'));

  /* Flag modal */
  qs('#flag-cancel-btn').addEventListener('click', () => {
    qs('#modal-flag').classList.add('hidden');
    pendingFlag = null;
  });
  qs('#flag-submit-btn').addEventListener('click', submitFlag);

  /* Delegated: link clicks inside message area */
  document.addEventListener('click', (e) => {
    const link = e.target.closest('.msg-link');
    if (link) {
      e.preventDefault();
      const url = decodeURIComponent(link.dataset.url || '');
      const display = link.textContent.replace(/^🔗\s*/, '').trim();
      if (url) showLinkWarning(url, display);
    }
  });

  /* Delegated: flag buttons inside message area */
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.flag-btn');
    if (btn) openFlagModal(btn.dataset.convId, btn.dataset.msgId);
  });

  /* Fix broken avatar images */
  document.addEventListener('error', (e) => {
    if (e.target.tagName === 'IMG' && e.target.classList.contains('avatar')) {
      e.target.src = defaultAvatar(e.target.alt || '?');
    }
    if (e.target.tagName === 'IMG' && e.target.classList.contains('conv-avatar')) {
      e.target.src = defaultAvatar(e.target.alt || '?');
    }
  }, true);
}

/* ─── Inbox ────────────────────────────────────────────────────────────────── */
async function loadInbox() {
  stopPolling();
  activeConvId = null;
  showView('view-inbox');

  /* Header */
  qs('#inbox-username').textContent = `@${currentUser.username}`;

  let allConvs;
  try {
    allConvs = await Storage.getConversations();
  } catch (err) {
    showToast(`Failed to load inbox: ${err.message}`, 'error');
    return;
  }
  const myConvs  = Object.values(allConvs)
    .filter((c) => c.participants.includes(currentUser.username));

  /* Incoming pending (recipient hasn't acted yet) */
  const pendingIn = myConvs.filter(
    (c) => c.status === 'pending' && c.initiator !== currentUser.username
  );
  /* Everything else, newest first */
  const rest = myConvs
    .filter((c) => !(c.status === 'pending' && c.initiator !== currentUser.username))
    .sort((a, b) => (b.lastActivity || 0) - (a.lastActivity || 0));

  /* Pending section */
  const pendingSec  = qs('#pending-requests-section');
  const pendingList = qs('#pending-requests-list');
  if (pendingIn.length) {
    pendingSec.classList.remove('hidden');
    pendingList.innerHTML = pendingIn.map(buildConvItem).join('');
  } else {
    pendingSec.classList.add('hidden');
    pendingList.innerHTML = '';
  }

  /* Conversation list */
  const listEl   = qs('#conversations-list');
  const emptyEl  = qs('#empty-inbox');
  if (rest.length === 0) {
    listEl.innerHTML = '';
    listEl.appendChild(emptyEl);
    emptyEl.classList.remove('hidden');
  } else {
    emptyEl.classList.add('hidden');
    listEl.innerHTML = rest.map(buildConvItem).join('');
  }

  /* Click handlers */
  [listEl, pendingList].forEach((el) => {
    el.querySelectorAll('.conv-item[data-conv-id]').forEach((item) =>
      item.addEventListener('click', () => openConversation(item.dataset.convId))
    );
  });

  /* Badge */
  setBadge(myConvs);
}

function buildConvItem(conv) {
  const other    = conv.participants.find((p) => p !== currentUser.username);
  const lastMsg  = conv.messages[conv.messages.length - 1];
  const preview  = lastMsg
    ? (lastMsg.content.length > 42 ? lastMsg.content.slice(0, 42) + '…' : lastMsg.content)
    : '';
  const unread   = conv.messages.filter(
    (m) => !m.read && m.from !== currentUser.username
  ).length;
  const avatarSrc = conv.participantData?.[other]?.profileImage || defaultAvatar(other);

  let rowClass = '';
  let badge    = '';
  if (conv.status === 'pending') {
    if (conv.initiator === currentUser.username) {
      rowClass = ' awaiting-item';
      badge    = `<span class="conv-badge amber">Awaiting</span>`;
    } else {
      rowClass = ' pending-item';
      badge    = `<span class="conv-badge amber">New ✉</span>`;
    }
  } else if (conv.status === 'denied') {
    rowClass = ' denied-item';
    badge    = `<span class="conv-badge gray">Denied</span>`;
  } else if (unread > 0) {
    badge = `<span class="conv-badge">${unread}</span>`;
  }

  return `
    <div class="conv-item${rowClass}" data-conv-id="${conv.id}">
      <img class="conv-avatar" src="${avatarSrc}" alt="${other}" />
      <div class="conv-info">
        <div class="conv-header">
          <span class="conv-name">@${other}</span>
          <div style="display:flex;gap:5px;align-items:center">
            ${badge}
            <span class="conv-time">${lastMsg ? timeAgo(lastMsg.timestamp) : ''}</span>
          </div>
        </div>
        <div class="conv-preview">${preview}</div>
      </div>
    </div>`;
}

function setBadge(convs) {
  const unread = convs.reduce(
    (n, c) => n + c.messages.filter((m) => !m.read && m.from !== currentUser.username).length, 0
  );
  chrome.action.setBadgeText({ text: unread > 0 ? String(unread) : '' });
  if (unread > 0) chrome.action.setBadgeBackgroundColor({ color: '#3b49df' });
}

/* ─── Conversation view ────────────────────────────────────────────────────── */
async function openConversation(convId) {
  activeConvId = convId;
  showView('view-conversation');
  startPolling();

  let conv = await Storage.getConversation(convId);
  if (!conv) { showToast('Conversation not found.', 'error'); loadInbox(); return; }

  const other = conv.participants.find((p) => p !== currentUser.username);
  const av    = qs('#conv-avatar');
  av.src = conv.participantData?.[other]?.profileImage || defaultAvatar(other);
  av.alt = other;
  qs('#conv-username').textContent = `@${other}`;

  /* Mark messages as read (fire-and-forget; update locally for instant feedback) */
  conv.messages.forEach((m) => { if (m.from !== currentUser.username) m.read = true; });
  Storage.markConversationRead(convId).catch(() => {});

  renderConversationState(conv);
}

function renderConversationState(conv) {
  /* Hide all status bars first */
  ['approval-bar', 'awaiting-bar', 'denied-bar'].forEach((id) =>
    qs(`#${id}`).classList.add('hidden')
  );
  qs('#message-input-area').classList.add('hidden');

  if (conv.status === 'pending') {
    if (conv.initiator !== currentUser.username) {
      /* Recipient – show approve / deny */
      const firstMsg = conv.messages[0];
      qs('#approval-msg').textContent =
        `@${conv.initiator} wants to message you: "${firstMsg?.content?.slice(0, 70) || '…'}"`;
      qs('#approval-bar').classList.remove('hidden');
    } else {
      qs('#awaiting-bar').classList.remove('hidden');
    }
  } else if (conv.status === 'denied') {
    qs('#denied-bar').classList.remove('hidden');
  } else {
    /* active */
    qs('#message-input-area').classList.remove('hidden');
    qs('#message-input').focus();
  }

  renderMessages(conv);
}

function renderMessages(conv) {
  const area = qs('#messages-area');

  if (!conv.messages.length) {
    area.innerHTML = '<p style="text-align:center;color:#9ca3af;font-size:13px;padding-top:20px">No messages yet.</p>';
    return;
  }

  area.innerHTML = conv.messages.map((msg) => buildMessageHTML(msg, conv.id)).join('');
  area.scrollTop = area.scrollHeight;
}

function buildMessageHTML(msg, convId) {
  const isOut = msg.from === currentUser.username;
  const classes = ['message-bubble', isOut ? 'outgoing' : 'incoming'];
  if (msg.flagged) classes.push('flagged');

  const content = LinkSafety.renderContent(msg.content);

  const flagBtn = (!isOut && !msg.flagged)
    ? `<button class="flag-btn" data-conv-id="${convId}" data-msg-id="${msg.id}" title="Report message">🚩</button>`
    : '';

  return `
    <div class="message-wrapper ${isOut ? 'outgoing' : 'incoming'}">
      <div class="${classes.join(' ')}">${content}</div>
      <div class="message-meta">
        <span class="message-time">${timeAgo(msg.timestamp)}</span>
        ${flagBtn}
      </div>
    </div>`;
}

/* ─── Approval ─────────────────────────────────────────────────────────────── */
async function handleApproval(approved) {
  if (!activeConvId) return;
  await Storage.updateConversationStatus(activeConvId, approved ? 'active' : 'denied');
  showToast(approved ? 'Conversation approved!' : 'Conversation denied.', approved ? 'success' : '');
  const conv = await Storage.getConversation(activeConvId);
  renderConversationState(conv);
}

/* ─── Send Reply ───────────────────────────────────────────────────────────── */
async function sendReply() {
  const input = qs('#message-input');
  const content = input.value.trim();
  if (!content || !activeConvId) return;

  const conv = await Storage.getConversation(activeConvId);
  if (!conv || conv.status !== 'active') {
    showToast('Cannot send: conversation not active.', 'error');
    return;
  }

  const msg = {
    id:        Storage.generateId(),
    from:      currentUser.username,
    content,
    timestamp: Date.now(),
    read:      false,
    flagged:   false,
    flagReason:'',
  };
  await Storage.addMessage(activeConvId, msg);
  input.value = '';

  const updated = await Storage.getConversation(activeConvId);
  renderMessages(updated);
}

/* ─── New Message ──────────────────────────────────────────────────────────── */
function openNewMessageView() {
  foundUser = null;
  qs('#user-search-input').value = '';
  qs('#user-search-result').classList.add('hidden');
  qs('#user-search-error').classList.add('hidden');
  qs('#first-message-input').value = '';
  qs('#send-first-btn').disabled = false;
  showView('view-new-message');
  qs('#user-search-input').focus();
}

async function searchUser() {
  const input  = qs('#user-search-input');
  const errEl  = qs('#user-search-error');
  const resDiv = qs('#user-search-result');
  const username = input.value.trim().replace(/^@/, '').toLowerCase();

  errEl.classList.add('hidden');
  resDiv.classList.add('hidden');

  if (!username) return;

  if (username === currentUser.username) {
    errEl.textContent = "You can't message yourself.";
    errEl.classList.remove('hidden');
    return;
  }

  const blocked = await Storage.getBlockedUsers();
  if (blocked.includes(username)) {
    errEl.textContent = 'This user is blocked.';
    errEl.classList.remove('hidden');
    return;
  }

  const btn = qs('#user-search-btn');
  btn.disabled = true; btn.textContent = 'Searching…';
  const result = await Eligibility.check(username);
  btn.disabled = false; btn.textContent = 'Find';

  if (result.error) {
    errEl.textContent = result.error;
    errEl.classList.remove('hidden');
    return;
  }

  foundUser = result;
  const card = qs('#found-user-card');
  const badgeClass = result.eligible ? 'badge-ok' : 'badge-no';
  const badgeText  = result.eligible ? '✓ Can receive messages' : '✗ Not eligible yet';

  card.innerHTML = `
    <img class="avatar" src="${result.profileImage || defaultAvatar(result.username)}" alt="${result.username}" style="width:40px;height:40px">
    <div class="user-card-info">
      <div class="user-card-name">${result.name || result.username}</div>
      <div class="user-card-meta">@${result.username} · ${result.articlesCount} post${result.articlesCount !== 1 ? 's' : ''} · joined ${result.daysSince}d ago</div>
    </div>
    <span class="eligibility-badge ${badgeClass}">${badgeText}</span>`;

  qs('#send-first-btn').disabled = !result.eligible;
  resDiv.classList.remove('hidden');
  if (result.eligible) qs('#first-message-input').focus();
}

async function sendFirstMessage() {
  if (!foundUser?.eligible) return;

  const content = qs('#first-message-input').value.trim();
  if (!content) { showToast('Please write a message first.', 'error'); return; }

  const toUsername = foundUser.username;
  const convId     = Storage.convId(currentUser.username, toUsername);
  const existing   = await Storage.getConversation(convId);

  if (existing) {
    showToast('Conversation already exists.');
    await openConversation(convId);
    return;
  }

  const msg = {
    id:        Storage.generateId(),
    from:      currentUser.username,
    content,
    timestamp: Date.now(),
    read:      false,
    flagged:   false,
    flagReason:'',
  };

  const conv = {
    id:           convId,
    participants: [currentUser.username, toUsername],
    initiator:    currentUser.username,
    status:       'pending',
    messages:     [msg],
    lastActivity: Date.now(),
    participantData: {
      [currentUser.username]: { profileImage: currentUser.profileImage, name: currentUser.name },
      [toUsername]:           { profileImage: foundUser.profileImage,   name: foundUser.name   },
    },
  };

  await Storage.upsertConversation(convId, conv);
  foundUser = null;
  showToast('Message request sent!', 'success');
  await openConversation(convId);
}

/* ─── Flag / Report ────────────────────────────────────────────────────────── */
function openFlagModal(convId, msgId) {
  pendingFlag = { convId, msgId };
  document.querySelectorAll('input[name="flag-reason"]').forEach((r) => (r.checked = false));
  qs('#modal-flag').classList.remove('hidden');
}

async function submitFlag() {
  const reason = document.querySelector('input[name="flag-reason"]:checked')?.value;
  if (!reason) { showToast('Please select a reason.', 'error'); return; }
  if (!pendingFlag) return;

  const { convId, msgId } = pendingFlag;
  await Storage.updateMessage(convId, msgId, { flagged: true, flagReason: reason });

  qs('#modal-flag').classList.add('hidden');
  pendingFlag = null;
  showToast('Message reported. Thank you.', 'success');

  /* Re-render if the flagged conversation is still open */
  if (activeConvId === convId) {
    const updated = await Storage.getConversation(convId);
    if (updated) renderMessages(updated);
  }
}

/* ─── Link Safety ──────────────────────────────────────────────────────────── */
function showLinkWarning(url, displayText) {
  qs('#link-warning-url').textContent = url;

  const isSpoofed = displayText && LinkSafety.isSpoofed(displayText, url);
  qs('#spoof-warning').classList.toggle('hidden', !isSpoofed);

  /* Swap proceed handler each time */
  const proceedBtn = qs('#link-proceed-btn');
  const newBtn = proceedBtn.cloneNode(true);
  proceedBtn.parentNode.replaceChild(newBtn, proceedBtn);
  newBtn.addEventListener('click', () => {
    qs('#modal-link-warning').classList.add('hidden');
    chrome.tabs.create({ url });
  });

  qs('#modal-link-warning').classList.remove('hidden');
}

/* ─── Bootstrap ────────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', init);
