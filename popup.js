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

/* ─── Visual preference helpers ────────────────────────────────────────────── */

/**
 * Injects a <style> tag so font-size changes override ALL explicit px rules
 * in the stylesheet — the only reliable way to scale text across the whole
 * extension when child elements have hard-coded font-size values.
 */
function applyBubbleColors(sentColor, receivedColor) {
  const s = sentColor ?? '#3b49df';
  const r = receivedColor ?? '#ffffff';
  document.documentElement.style.setProperty('--sent-bubble', s);
  document.documentElement.style.setProperty('--received-bubble', r);
  const si = qs('#sent-color-input');     if (si) { si.value = s; }
  const ri = qs('#received-color-input'); if (ri) { ri.value = r; }
  const ss = qs('#sent-swatch');          if (ss) ss.style.background = s;
  const rs = qs('#received-swatch');      if (rs) rs.style.background = r;
}

function applyBgGradient(start, end, dir) {
  if (start && end) {
    document.documentElement.style.setProperty(
      '--bg-gradient', `linear-gradient(${dir ?? '135deg'}, ${start}, ${end})`
    );
  } else {
    document.documentElement.style.removeProperty('--bg-gradient');
  }
  const gs = qs('#grad-start-input'); if (gs && start) gs.value = start;
  const ge = qs('#grad-end-input');   if (ge && end)   ge.value = end;
  const gd = qs('#grad-direction');   if (gd && dir)   gd.value = dir;
  const ss = qs('#grad-start-swatch'); if (ss) ss.style.background = start ?? 'transparent';
  const es = qs('#grad-end-swatch');   if (es) es.style.background = end   ?? 'transparent';
}

function applyFontSize(size) {
  let el = document.getElementById('dyn-font-size');
  if (!el) { el = document.createElement('style'); el.id = 'dyn-font-size'; document.head.appendChild(el); }
  el.textContent = [
    `body { font-size: ${size}px !important; }`,
    `.message-bubble { font-size: ${Math.max(10, size - 1)}px !important; }`,
    `.message-textarea { font-size: ${Math.max(10, size - 1)}px !important; }`,
    `.conv-name { font-size: ${size}px !important; }`,
    `.conv-preview { font-size: ${Math.max(10, size - 2)}px !important; }`,
    `.status-bar { font-size: ${Math.max(10, size - 1)}px !important; }`,
    `.user-card-name { font-size: ${size}px !important; }`,
    `.approval-text { font-size: ${Math.max(10, size - 1)}px !important; }`,
  ].join('\n');
  document.querySelectorAll('.font-size-btn').forEach((btn) => {
    btn.classList.toggle('active', Number(btn.dataset.size) === size);
  });
}

function applyBgColor(hue, sat) {
  document.documentElement.style.setProperty('--bg-hue', hue ?? 0);
  document.documentElement.style.setProperty('--bg-sat', `${sat ?? 0}%`);
  /* Update sat slider gradient to reflect current hue */
  const satSlider = qs('#bg-sat-slider');
  if (satSlider) {
    satSlider.style.background = `linear-gradient(to right, hsl(${hue ?? 0},0%,60%), hsl(${hue ?? 0},100%,60%))`;
    satSlider.value = sat ?? 0;
  }
  const hueSlider = qs('#bg-hue-slider');
  if (hueSlider) hueSlider.value = hue ?? 0;
}

function applyTextColor(hue, sat) {
  document.documentElement.style.setProperty('--text-hue', hue ?? 0);
  document.documentElement.style.setProperty('--text-sat', `${sat ?? 0}%`);
  /* Update sat slider gradient to reflect current hue */
  const satSlider = qs('#text-sat-slider');
  if (satSlider) {
    satSlider.style.background = `linear-gradient(to right, hsl(${hue ?? 0},0%,40%), hsl(${hue ?? 0},100%,30%))`;
    satSlider.value = sat ?? 0;
  }
  const hueSlider = qs('#text-hue-slider');
  if (hueSlider) hueSlider.value = hue ?? 0;
}
/* ─── Init ─────────────────────────────────────────────────────────────────── */
async function init() {
  /* Apply all visual preferences before any view renders to avoid flash */
  const prefs = await chrome.storage.local.get(['darkMode', 'bgHue', 'bgSat', 'fontSize', 'textHue', 'textSat', 'sentBubbleColor', 'receivedBubbleColor', 'gradStart', 'gradEnd', 'gradDir']);
  if (prefs.darkMode) {
    document.body.classList.add('dark');
    qs('#dark-toggle').textContent = '☀️ On';
  }
  applyBgColor(prefs.bgHue ?? 0, prefs.bgSat ?? 0);
  applyFontSize(prefs.fontSize ?? 14);
  applyTextColor(prefs.textHue ?? 0, prefs.textSat ?? 0);
  applyBubbleColors(prefs.sentBubbleColor ?? null, prefs.receivedBubbleColor ?? null);
  applyBgGradient(prefs.gradStart ?? null, prefs.gradEnd ?? null, prefs.gradDir ?? '135deg');

  /* If running in a popped-out window, expand to fill and hide popout buttons */
  const isPopout = new URLSearchParams(location.search).get('popout') === '1';
  if (isPopout) {
    document.body.classList.add('popout-mode');
    document.querySelectorAll('#popout-btn, #conv-popout-btn').forEach(b => b.classList.add('hidden'));
  }

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
  qs('#back-btn').addEventListener('click', () => { closeGifPicker(); loadInbox(); });
  qs('#new-msg-back-btn').addEventListener('click', loadInbox);
  qs('#new-message-btn').addEventListener('click', openNewMessageView);

  /* Pop-out window */
  function openPopoutWindow() {
    chrome.windows.create({
      url: chrome.runtime.getURL('popup.html?popout=1'),
      type: 'popup',
      width: 420,
      height: 640
    });
  }
  qs('#popout-btn').addEventListener('click', openPopoutWindow);
  qs('#conv-popout-btn').addEventListener('click', openPopoutWindow);

  /* Dark mode toggle */
  qs('#dark-toggle').addEventListener('click', async () => {
    const isDark = document.body.classList.toggle('dark');
    qs('#dark-toggle').textContent = isDark ? '☀️ On' : '🌙 Off';
    await chrome.storage.local.set({ darkMode: isDark });
  });

  /* Background color sliders */
  qs('#bg-hue-slider').addEventListener('input', async (e) => {
    const hue = Number(e.target.value);
    const sat = Number(qs('#bg-sat-slider').value);
    applyBgColor(hue, sat);
    await chrome.storage.local.set({ bgHue: hue });
  });
  qs('#bg-sat-slider').addEventListener('input', async (e) => {
    const sat = Number(e.target.value);
    const hue = Number(qs('#bg-hue-slider').value);
    applyBgColor(hue, sat);
    await chrome.storage.local.set({ bgSat: sat });
  });
  qs('#bg-color-reset').addEventListener('click', async () => {
    applyBgColor(0, 0);
    await chrome.storage.local.set({ bgHue: 0, bgSat: 0 });
  });

  /* Font size buttons */
  document.querySelectorAll('.font-size-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const size = Number(btn.dataset.size);
      applyFontSize(size);
      await chrome.storage.local.set({ fontSize: size });
    });
  });

  /* Text color sliders */
  qs('#text-hue-slider').addEventListener('input', async (e) => {
    const hue = Number(e.target.value);
    const sat = Number(qs('#text-sat-slider').value);
    applyTextColor(hue, sat);
    await chrome.storage.local.set({ textHue: hue });
  });
  qs('#text-sat-slider').addEventListener('input', async (e) => {
    const sat = Number(e.target.value);
    const hue = Number(qs('#text-hue-slider').value);
    applyTextColor(hue, sat);
    await chrome.storage.local.set({ textSat: sat });
  });
  qs('#text-color-reset').addEventListener('click', async () => {
    applyTextColor(0, 0);
    await chrome.storage.local.set({ textHue: 0, textSat: 0 });
  });

  /* Bubble color panel */
  qs('#bubble-color-btn').addEventListener('click', () => {
    qs('#bubble-color-panel').classList.toggle('hidden');
  });
  qs('#sent-color-input').addEventListener('input', async (e) => {
    const color = e.target.value;
    document.documentElement.style.setProperty('--sent-bubble', color);
    qs('#sent-swatch').style.background = color;
    await chrome.storage.local.set({ sentBubbleColor: color });
  });
  qs('#received-color-input').addEventListener('input', async (e) => {
    const color = e.target.value;
    document.documentElement.style.setProperty('--received-bubble', color);
    qs('#received-swatch').style.background = color;
    await chrome.storage.local.set({ receivedBubbleColor: color });
  });

  /* Background gradient */
  function getGradValues() {
    return {
      start: qs('#grad-start-input').value,
      end:   qs('#grad-end-input').value,
      dir:   qs('#grad-direction').value,
    };
  }
  qs('#grad-start-input').addEventListener('input', async (e) => {
    const { end, dir } = getGradValues();
    applyBgGradient(e.target.value, end, dir);
    await chrome.storage.local.set({ gradStart: e.target.value });
  });
  qs('#grad-end-input').addEventListener('input', async (e) => {
    const { start, dir } = getGradValues();
    applyBgGradient(start, e.target.value, dir);
    await chrome.storage.local.set({ gradEnd: e.target.value });
  });
  qs('#grad-direction').addEventListener('change', async (e) => {
    const { start, end } = getGradValues();
    applyBgGradient(start, end, e.target.value);
    await chrome.storage.local.set({ gradDir: e.target.value });
  });

  qs('#bubble-color-reset').addEventListener('click', async () => {
    applyBubbleColors(null, null);
    applyBgGradient(null, null, '135deg');
    await chrome.storage.local.set({ sentBubbleColor: null, receivedBubbleColor: null, gradStart: null, gradEnd: null, gradDir: '135deg' });
  });

  /* GIF picker */
  qs('#gif-btn').addEventListener('click', toggleGifPicker);
  qs('#gif-close-btn').addEventListener('click', closeGifPicker);
  qs('#gif-search').addEventListener('input', filterGifs);

  /* Emoji picker */
  qs('#emoji-btn').addEventListener('click', (e) => { e.stopPropagation(); toggleEmojiPicker(); });
  qs('#emoji-search').addEventListener('input', (e) => {
    const q = e.target.value.trim().toLowerCase();
    renderEmojiGrid(q ? EMOJIS.filter(item => item.t.includes(q) || item.e === q) : EMOJIS);
  });
  document.addEventListener('click', (e) => {
    if (!qs('#emoji-picker').classList.contains('hidden') &&
        !qs('#emoji-picker').contains(e.target) &&
        e.target !== qs('#emoji-btn')) {
      closeEmojiPicker();
    }
  });

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

  /* Delete conversation */
  qs('#delete-conv-btn').addEventListener('click', deleteConversation);

  /* Block user */
  qs('#block-user-btn').addEventListener('click', toggleBlockUser);

  /* Settings */
  qs('#settings-btn').addEventListener('click', openSettings);
  qs('#settings-back-btn').addEventListener('click', loadInbox);

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

  /* Meme lightbox: open on click, close on button or backdrop */
  document.addEventListener('click', (e) => {
    if (e.target.classList.contains('msg-gif')) openLightbox(e.target.src);
  });
  qs('#meme-lightbox-close').addEventListener('click', closeLightbox);
  qs('#meme-lightbox').addEventListener('click', (e) => {
    if (e.target === qs('#meme-lightbox')) closeLightbox();
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

/* ─── GIF Picker ───────────────────────────────────────────────────────────── */
async function toggleGifPicker() {
  const picker = qs('#gif-picker');
  if (!picker.classList.contains('hidden')) { closeGifPicker(); return; }
  picker.classList.remove('hidden');
  if (!GifPicker._cache) await loadGifGrid();
}

function closeGifPicker() {
  qs('#gif-picker').classList.add('hidden');
  qs('#gif-search').value = '';
  filterGifs();
}

/* ─── Emoji Picker ────────────────────────────────────────────────────────── */
const EMOJIS = [
  {e:'😀',t:'grinning happy smile face'},{e:'😁',t:'beaming happy smile'},{e:'😂',t:'joy laugh tears cry funny'},{e:'🤣',t:'rolling laugh floor funny'},{e:'😃',t:'grinning happy smile big eyes'},{e:'😄',t:'grinning smile eyes'},{e:'😅',t:'sweat smile nervous'},{e:'😆',t:'laughing happy squinting'},{e:'😇',t:'innocent halo angel'},{e:'😈',t:'smiling devil evil'},{e:'😉',t:'wink'},{e:'😊',t:'blush smile happy'},
  {e:'😋',t:'yum delicious food'},{e:'😌',t:'relieved calm'},{e:'😍',t:'heart eyes love'},{e:'🥰',t:'hearts smiling love'},{e:'😎',t:'sunglasses cool'},{e:'🤩',t:'star struck excited wow'},{e:'🥳',t:'partying celebrate birthday'},{e:'😏',t:'smirk'},
  {e:'😒',t:'unamused meh'},{e:'😞',t:'disappointed sad'},{e:'😔',t:'pensive sad'},{e:'😟',t:'worried'},{e:'😕',t:'confused'},{e:'🙁',t:'slightly frowning sad'},{e:'😣',t:'persevere'},{e:'😖',t:'confounded'},{e:'😫',t:'tired weary'},{e:'😩',t:'weary tired'},{e:'🥺',t:'pleading puppy eyes sad'},{e:'😢',t:'cry sad tear'},
  {e:'😭',t:'loudly crying sob sad'},{e:'😤',t:'steam triumph frustrated'},{e:'😠',t:'angry mad'},{e:'😡',t:'pouting rage angry red'},{e:'🤬',t:'cursing symbols angry'},{e:'🤯',t:'exploding head mind blown'},{e:'😳',t:'flushed embarrassed shocked'},{e:'🥵',t:'hot flushed sweat'},{e:'🥶',t:'cold frozen blue'},{e:'😱',t:'screaming fear shocked'},{e:'😨',t:'fearful scared'},{e:'😰',t:'anxious sweat cold'},
  {e:'😥',t:'sad relieved'},{e:'😓',t:'downcast sweat'},{e:'🤔',t:'thinking hmm'},{e:'🤭',t:'hand over mouth giggle'},{e:'🤫',t:'shushing quiet'},{e:'🤥',t:'lying pinocchio'},{e:'😶',t:'no mouth silent'},{e:'😐',t:'neutral'},{e:'😑',t:'expressionless'},{e:'😬',t:'grimacing awkward'},{e:'🙄',t:'eye roll'},{e:'😯',t:'hushed surprised'},{e:'😦',t:'frowning open mouth'},{e:'😧',t:'anguished'},{e:'😮',t:'open mouth surprised'},{e:'😲',t:'astonished shocked'},
  {e:'🥱',t:'yawn tired bored'},{e:'😴',t:'sleeping zzz tired'},{e:'🤤',t:'drooling hungry'},
  {e:'👍',t:'thumbs up like good ok yes'},{e:'👎',t:'thumbs down dislike no bad'},{e:'👏',t:'clap applause'},{e:'🙌',t:'raised hands celebrate'},{e:'🤝',t:'handshake deal'},{e:'✊',t:'raised fist power'},{e:'👊',t:'oncoming fist punch'},{e:'✋',t:'raised hand stop'},{e:'👋',t:'wave hello bye'},{e:'🤙',t:'call me shaka'},{e:'💪',t:'muscle strong flex'},{e:'🙏',t:'pray thanks folded hands'},
  {e:'👌',t:'ok perfect'},{e:'✌️',t:'peace victory two'},{e:'🤞',t:'fingers crossed luck'},{e:'👈',t:'left point'},{e:'👉',t:'right point'},{e:'👆',t:'up point'},{e:'👇',t:'down point'},{e:'👀',t:'eyes look see'},
  {e:'❤️',t:'red heart love'},{e:'🧡',t:'orange heart'},{e:'💛',t:'yellow heart'},{e:'💚',t:'green heart'},{e:'💙',t:'blue heart'},{e:'💜',t:'purple heart'},{e:'🖤',t:'black heart'},{e:'🤍',t:'white heart'},{e:'💔',t:'broken heart sad'},{e:'💕',t:'two hearts love'},{e:'💯',t:'hundred percent perfect'},
  {e:'🔥',t:'fire hot flame lit'},{e:'⭐',t:'star'},{e:'✨',t:'sparkles glitter'},{e:'💥',t:'collision boom explosion'},{e:'🎉',t:'party tada celebrate'},{e:'🎊',t:'confetti celebrate'},{e:'🎁',t:'gift present'},{e:'🏆',t:'trophy winner'},{e:'🥇',t:'gold medal first'},{e:'🎯',t:'bullseye target'},{e:'🎮',t:'video game controller'},{e:'🎲',t:'dice game'},
  {e:'🆗',t:'ok button'},{e:'💬',t:'speech bubble chat message'},{e:'💭',t:'thought bubble thinking'},{e:'📣',t:'megaphone loud'},{e:'📱',t:'phone mobile'},
  {e:'🌟',t:'glowing star'},{e:'🌈',t:'rainbow'},{e:'🌸',t:'cherry blossom flower'},{e:'🌺',t:'hibiscus flower'},{e:'🌻',t:'sunflower'},{e:'🌹',t:'rose flower'},{e:'🍀',t:'four leaf clover luck'},{e:'🌊',t:'wave water ocean'},{e:'⚡',t:'lightning bolt zap electric'},{e:'❄️',t:'snowflake cold ice'},{e:'🌙',t:'crescent moon night'},{e:'☀️',t:'sun sunny'},{e:'🌍',t:'earth globe world'},{e:'🦋',t:'butterfly'},
  {e:'🍕',t:'pizza food'},{e:'🍔',t:'burger food'},{e:'🌮',t:'taco food'},{e:'🍣',t:'sushi food'},{e:'🍜',t:'noodles ramen food'},{e:'🎂',t:'birthday cake'},{e:'🍰',t:'cake slice'},{e:'🍩',t:'doughnut donut'},{e:'☕',t:'coffee hot drink'},{e:'🍵',t:'tea hot drink'},{e:'🧋',t:'bubble tea boba'},{e:'🍺',t:'beer cheers'},{e:'🥂',t:'clinking glasses cheers toast'},{e:'🍾',t:'champagne bottle celebrate'},
];

function toggleEmojiPicker() {
  const panel = qs('#emoji-picker');
  const isHidden = panel.classList.contains('hidden');
  panel.classList.toggle('hidden');
  if (isHidden) {
    renderEmojiGrid(EMOJIS);
    qs('#emoji-search').value = '';
    qs('#emoji-search').focus();
  }
}

function closeEmojiPicker() {
  qs('#emoji-picker').classList.add('hidden');
}

function renderEmojiGrid(list) {
  const grid = qs('#emoji-grid');
  grid.innerHTML = '';
  list.forEach(({ e, t }) => {
    const btn = document.createElement('button');
    btn.className = 'emoji-btn-item';
    btn.textContent = e;
    btn.title = t.split(' ')[0];
    btn.setAttribute('type', 'button');
    btn.addEventListener('click', () => {
      const ta = qs('#message-input');
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      ta.value = ta.value.slice(0, start) + e + ta.value.slice(end);
      ta.selectionStart = ta.selectionEnd = start + e.length;
      ta.focus();
      closeEmojiPicker();
    });
    grid.appendChild(btn);
  });
}

function filterGifs() {
  const query = qs('#gif-search').value.trim().toLowerCase();
  const terms = query.split(/\s+/).filter(Boolean);
  qs('#gif-grid').querySelectorAll('.gif-cell').forEach(cell => {
    const alt = (cell.querySelector('.gif-thumb')?.alt || '').toLowerCase();
    const match = !terms.length || terms.every(t => alt.includes(t));
    cell.style.display = match ? '' : 'none';
  });
}

function openLightbox(src) {
  qs('#meme-lightbox-img').src = src;
  qs('#meme-lightbox').classList.remove('hidden');
}

function closeLightbox() {
  qs('#meme-lightbox').classList.add('hidden');
  qs('#meme-lightbox-img').src = '';
}

async function loadGifGrid() {
  const grid = qs('#gif-grid');
  grid.innerHTML = '<p class="gif-loading">Loading memes… (fetching community comments)</p>';
  const images = await GifPicker.fetchImages();
  grid.innerHTML = '';
  if (!images.length) {
    grid.innerHTML = '<p class="gif-loading">No memes found.</p>';
    return;
  }
  for (const { url, title } of images) {
    const cell = document.createElement('div');
    cell.className = 'gif-cell';

    const img = document.createElement('img');
    img.src = url;
    img.alt = title;
    img.title = title;
    img.className = 'gif-thumb';
    img.addEventListener('click', () => {
      qs('#message-input').value = `[gif]:${url}`;
      closeGifPicker();
      sendReply();
    });

    const magnify = document.createElement('button');
    magnify.className = 'gif-magnify';
    magnify.textContent = '🔍';
    magnify.title = 'Preview';
    magnify.addEventListener('click', (e) => {
      e.stopPropagation();
      openLightbox(url);
    });

    cell.appendChild(img);
    cell.appendChild(magnify);
    grid.appendChild(cell);
  }
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

  /* Also filter any locally-hidden conversation IDs (client-side safety net) */
  const { hiddenConvs = [] } = await chrome.storage.local.get('hiddenConvs');
  const myConvs  = Object.values(allConvs)
    .filter((c) => c.participants.includes(currentUser.username) && !hiddenConvs.includes(c.id));

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
  const messages = conv.messages || [];
  const lastMsg  = messages[messages.length - 1];
  const preview  = lastMsg
    ? (() => {
        if (lastMsg.content.startsWith('[gif]:')) return '🎭 Meme';
        return lastMsg.content.length > 42 ? lastMsg.content.slice(0, 42) + '…' : lastMsg.content;
      })()
    : '';
  const unread   = messages.filter(
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
    (n, c) => n + (c.messages || []).filter((m) => !m.read && m.from !== currentUser.username).length, 0
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
  convOtherUser = other;
  const av    = qs('#conv-avatar');
  av.src = conv.participantData?.[other]?.profileImage || defaultAvatar(other);
  av.alt = other;
  qs('#conv-username').textContent = `@${other}`;

  /* Sync block button state */
  const blocked = await Storage.getBlockedUsers().catch(() => []);
  const isBlocked = blocked.some((b) => b.username === other);
  const blockBtn = qs('#block-user-btn');
  blockBtn.dataset.blocked = isBlocked ? 'true' : 'false';
  blockBtn.title = isBlocked ? `Unblock @${other}` : `Block @${other}`;
  blockBtn.style.color = isBlocked ? '#ef4444' : '#f59e0b';

  /* Reset any previous blocked-by notice */
  resetBlockedByNotice();

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
      /* Recipient – show approve / deny + full first message preview */
      const firstMsg = conv.messages[0];
      const preview  = firstMsg
        ? (firstMsg.content.startsWith('[gif]:')
            ? '🎭 <em>(sent a meme)</em>'
            : LinkSafety.renderContent(firstMsg.content))
        : '…';
      qs('#approval-msg').innerHTML =
        `<strong>@${conv.initiator}</strong> wants to message you:<br>
         <div class="approval-preview">${preview}</div>`;
      qs('#approval-bar').classList.remove('hidden');
    } else {
      /* Initiator – waiting; input locked */
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

  try {
    await Storage.addMessage(activeConvId, msg);
  } catch (err) {
    if (err.message === 'blocked') {
      showBlockedByOtherNotice(convOtherUser);
    } else {
      showToast('Failed to send message.', 'error');
    }
    return;
  }

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

  let blocked = [];
  try { blocked = await Storage.getBlockedUsers(); } catch { /* non-fatal */ }
  if (blocked.some((b) => b.username === username)) {
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

  /* Check local hidden list first */
  const { hiddenConvs = [] } = await chrome.storage.local.get('hiddenConvs');
  if (hiddenConvs.includes(convId)) {
    /* Unhide and reopen the existing conversation */
    await chrome.storage.local.set({ hiddenConvs: hiddenConvs.filter((id) => id !== convId) });
    showToast('Conversation restored.');
    await openConversation(convId);
    return;
  }

  const existing = await Storage.getConversation(convId);
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

/* ─── Delete conversation ──────────────────────────────────────────────────── */
async function deleteConversation() {
  if (!activeConvId) return;
  if (!confirm('Delete this conversation? This cannot be undone.')) return;
  const convId = activeConvId;
  try {
    await Storage.deleteConversation(convId);
  } catch (err) {
    /* Non-fatal – still hide it locally */
    console.warn('[delete] server error, hiding locally:', err.message);
  }
  /* Always hide locally so it disappears even if server filter lags */
  const { hiddenConvs = [] } = await chrome.storage.local.get('hiddenConvs');
  if (!hiddenConvs.includes(convId)) {
    await chrome.storage.local.set({ hiddenConvs: [...hiddenConvs, convId] });
  }
  showToast('Conversation deleted.');
  loadInbox();
}

/* ─── Blocked-by notice ────────────────────────────────────────────────────── */
function showBlockedByOtherNotice(otherUser) {
  const notice = qs('#blocked-by-notice');
  qs('#blocked-by-text').textContent = `@${otherUser} has blocked you. You can no longer send messages.`;
  notice.classList.remove('hidden');
  /* Disable the input area */
  qs('#message-input').disabled = true;
  qs('#send-btn').disabled = true;
  qs('#message-input').placeholder = 'Messaging unavailable.';
}

function resetBlockedByNotice() {
  qs('#blocked-by-notice').classList.add('hidden');
  qs('#message-input').disabled = false;
  qs('#send-btn').disabled = false;
  qs('#message-input').placeholder = 'Type a message… (Enter to send, Shift+Enter for newline)';
}

/* ─── Block / Unblock ──────────────────────────────────────────────────────── */
let convOtherUser = null; // username of the other participant in the open conversation

async function toggleBlockUser() {
  if (!convOtherUser) return;
  const btn = qs('#block-user-btn');
  const isBlocking = btn.dataset.blocked !== 'true';

  const action = isBlocking
    ? `Block @${convOtherUser}? They won't be able to message you.`
    : `Unblock @${convOtherUser}?`;
  if (!confirm(action)) return;

  try {
    if (isBlocking) {
      await Storage.blockUser(convOtherUser);
      btn.dataset.blocked = 'true';
      btn.title = `Unblock @${convOtherUser}`;
      btn.style.color = '#ef4444';
      showToast(`@${convOtherUser} blocked.`);
    } else {
      await Storage.unblockUser(convOtherUser);
      btn.dataset.blocked = 'false';
      btn.title = `Block @${convOtherUser}`;
      btn.style.color = '#f59e0b';
      showToast(`@${convOtherUser} unblocked.`);
    }
  } catch (err) {
    showToast(`Failed: ${err.message}`, 'error');
  }
}

/* ─── Settings view ────────────────────────────────────────────────────────── */
async function openSettings() {
  showView('view-settings');
  /* Sync slider and font buttons to current saved prefs */
  const { bgHue = 0, bgSat = 0, fontSize = 14, textHue = 0, textSat = 0 } =
    await chrome.storage.local.get(['bgHue', 'bgSat', 'fontSize', 'textHue', 'textSat']);
  applyBgColor(bgHue, bgSat);
  applyFontSize(fontSize);
  applyTextColor(textHue, textSat);
  const list  = qs('#blocked-users-list');
  const empty = qs('#no-blocked-msg');
  list.innerHTML = '<p class="muted small">Loading…</p>';
  try {
    const blocked = await Storage.getBlockedUsers();
    list.innerHTML = '';
    if (!blocked.length) {
      list.appendChild(empty);
      empty.classList.remove('hidden');
      return;
    }
    for (const { username } of blocked) {
      const row = document.createElement('div');
      row.className = 'blocked-user-row';
      row.innerHTML = `
        <span class="blocked-username">@${username}</span>
        <button class="btn btn-sm btn-secondary unblock-btn" data-username="${username}">Unblock</button>
      `;
      row.querySelector('.unblock-btn').addEventListener('click', async () => {
        try {
          await Storage.unblockUser(username);
          row.remove();
          if (!list.querySelector('.blocked-user-row')) list.appendChild(empty);
          showToast(`@${username} unblocked.`);
        } catch (err) {
          showToast(`Failed: ${err.message}`, 'error');
        }
      });
      list.appendChild(row);
    }
  } catch (err) {
    list.innerHTML = `<p class="error-text">Failed to load: ${err.message}</p>`;
  }
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
