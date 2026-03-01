/* background.js – Service worker */

/* Update the action badge whenever conversation data changes */
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.conversations) {
    refreshBadge(changes.conversations.newValue);
  }
});

async function refreshBadge(conversations) {
  if (!conversations) {
    chrome.action.setBadgeText({ text: '' });
    return;
  }
  const { currentUser } = await chrome.storage.local.get('currentUser');
  if (!currentUser) {
    chrome.action.setBadgeText({ text: '' });
    return;
  }

  let unread = 0;
  for (const conv of Object.values(conversations)) {
    if (!conv.participants.includes(currentUser.username)) continue;
    for (const msg of conv.messages) {
      if (!msg.read && msg.from !== currentUser.username) unread++;
    }
  }

  if (unread > 0) {
    chrome.action.setBadgeText({ text: String(unread) });
    chrome.action.setBadgeBackgroundColor({ color: '#3b49df' });
  } else {
    chrome.action.setBadgeText({ text: '' });
  }
}
