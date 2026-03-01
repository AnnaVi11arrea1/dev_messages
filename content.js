/* content.js – Runs on every dev.to page
 *
 * Responsibilities:
 *  1. Detect the currently logged-in Dev.to user and cache them in storage.
 *  2. Inject "Message" buttons on profile pages and article author headers.
 *  3. Watch for SPA navigation changes (Dev.to is a Turbo/SPA app).
 */

'use strict';

(async () => {
  await detectAndStoreCurrentUser();
  injectMessageButtons();
  watchForNavigation();
})();

/* ─── User Detection ───────────────────────────────────────────────────────── */
async function detectAndStoreCurrentUser() {
  /* Use the authenticated /api/users/me endpoint — content scripts send
   * the user's cookies automatically, so this reliably returns the
   * logged-in user without any DOM scraping. Always fetch and save so
   * stale cached values are never used. */
  try {
    const res = await fetch('https://dev.to/api/users/me', { credentials: 'include' });
    if (!res.ok) return;

    const user = await res.json();
    const username = (user.username || '').toLowerCase();
    if (!username) return;

    const profileImage = user.profile_image || user.profile_image_90 || getProfileImageFromDOM() || '';
    const name = user.name || username;

    await chrome.storage.local.set({ currentUser: { username, name, profileImage } });
  } catch { /* network error – silently skip */ }
}

function getProfileImageFromDOM() {
  /* Dev.to renders the logged-in user's avatar as an <img> inside the header nav.
   * Try several known selectors, most-specific first. */
  const selectors = [
    'header .crayons-header__actions a[href^="/"] img',
    'header a.crayons-avatar img',
    'nav a[data-tracking-id="current-user-nav-profile"] img',
    'header img.crayons-avatar__image',
    'header .profile-pic img',
  ];
  for (const sel of selectors) {
    const img = document.querySelector(sel);
    if (img?.src && !img.src.startsWith('data:')) return img.src;
  }
  return '';
}

function getUsernameFromDOM() {
  /* Forem/Dev.to injects the current user's profile link in the header.
   * We look for it using several fallback selectors. */

  const candidates = [
    /* Meta tag (present in some Forem versions) */
    document.querySelector('meta[name="current-user"]')?.content,

    /* User menu – the avatar/profile link href is "/username" */
    (() => {
      const link = document.querySelector(
        '.crayons-header__actions a[href^="/"][class*="profile"], ' +
        '.crayons-header a.crayons-avatar, ' +
        'header a.profile-pic, ' +
        'nav a[data-tracking-id="current-user-nav-profile"]'
      );
      if (!link) return null;
      return hrefToUsername(link.getAttribute('href'));
    })(),

    /* Fallback: any <a href="/username"> inside the site header that isn't
     * a reserved route (e.g. /dashboard, /settings, /notifications…) */
    (() => {
      const reserved = new Set([
        'dashboard','settings','notifications','readinglist',
        'connect','pod','listings','discuss','tags','enter','new',
        'search','about','privacy','terms','contact','report-abuse',
        'mod','admin','moderation','sponsors','advertise','jobs','shop',
        'api','sitemap','feed','robots.txt','assets','404','500',
        'manage','billing','organization','organizations','pages',
        'user','users','profile','account','security','integrations',
      ]);
      for (const a of document.querySelectorAll('header a[href^="/"], nav a[href^="/"]')) {
        const u = hrefToUsername(a.getAttribute('href'));
        if (u && !reserved.has(u)) return u;
      }
      return null;
    })(),
  ];

  return candidates.find(Boolean) || null;
}

function hrefToUsername(href) {
  if (!href) return null;
  const m = href.match(/^\/([A-Za-z0-9_-]+)\/?$/);
  return m ? m[1].toLowerCase() : null;
}

/* ─── Inject Message Buttons ───────────────────────────────────────────────── */
function injectMessageButtons() {
  injectOnProfilePage();
  injectOnArticlePage();
}

function injectOnProfilePage() {
  /* Profile page URL: dev.to/username */
  const m = window.location.pathname.match(/^\/([A-Za-z0-9_-]+)\/?$/);
  if (!m) return;
  const pageUsername = m[1].toLowerCase();

  chrome.storage.local.get('currentUser').then(({ currentUser }) => {
    if (currentUser?.username === pageUsername) return;

    const targets = [
      document.querySelector('.profile-header__actions'),
      document.querySelector('.profile-header'),
      document.querySelector('[data-testid="profile-header"]'),
    ].filter(Boolean);

    for (const target of targets) {
      if (target.querySelector('.devmsg-btn')) return;
      target.appendChild(buildMessageButton(pageUsername, false));
      break;
    }
  }).catch(() => {});
}

function injectOnArticlePage() {
  /* Article author byline */
  document.querySelectorAll(
    '.author-preview, .article-header .user-details, .crayons-article__subheader .profile-preview-card'
  ).forEach((el) => {
    if (el.querySelector('.devmsg-btn')) return;
    const link = el.querySelector('a[href^="/"]');
    if (!link) return;
    const username = hrefToUsername(link.getAttribute('href'));
    if (!username) return;
    chrome.storage.local.get('currentUser', ({ currentUser }) => {
      if (currentUser?.username === username) return;
      el.appendChild(buildMessageButton(username, true));
    });
  });
}

function buildMessageButton(username, compact) {
  const btn = document.createElement('button');
  btn.className = 'devmsg-btn';
  btn.title = `Message @${username}`;
  btn.setAttribute('aria-label', `Send a message to ${username}`);

  if (compact) {
    btn.textContent = '✉';
    btn.style.cssText =
      'background:none;border:none;cursor:pointer;font-size:15px;padding:2px 5px;' +
      'opacity:0.65;transition:opacity 0.1s;vertical-align:middle;';
    btn.addEventListener('mouseover', () => { btn.style.opacity = '1'; });
    btn.addEventListener('mouseout',  () => { btn.style.opacity = '0.65'; });
  } else {
    btn.textContent = '✉ Message';
    btn.style.cssText =
      'background:#3b49df;color:#fff;border:none;padding:6px 14px;border-radius:6px;' +
      'cursor:pointer;font-size:14px;font-weight:600;margin-left:8px;' +
      'transition:background 0.15s;';
    btn.addEventListener('mouseover', () => { btn.style.background = '#2f3db5'; });
    btn.addEventListener('mouseout',  () => { btn.style.background = '#3b49df'; });
  }

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    chrome.storage.local.set({ pendingNewMessageTo: username });
    /* The popup will read pendingNewMessageTo on open */
  });

  return btn;
}

/* ─── Watch for SPA navigation ─────────────────────────────────────────────── */
function watchForNavigation() {
  let lastUrl = location.href;

  /* Turbo / Turbolinks fire this event */
  document.addEventListener('turbo:load', () => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      injectMessageButtons();
    }
  });

  /* Fallback: MutationObserver for content changes */
  const observer = new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      injectMessageButtons();
    }
  });
  observer.observe(document.body, { childList: true, subtree: false });
}
