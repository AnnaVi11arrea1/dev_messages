# Dev.to Messages (Unofficial 3rd Party Extension)

A Chrome extension that adds private direct messaging to [Dev.to](https://dev.to), with built-in link safety, spam reporting, and a first-contact approval system.

---

## File Structure

```
dev_messages/
├── manifest.json          MV3 manifest
├── background.js          Service worker – updates unread badge
├── content.js             Injected into dev.to – detects user, adds Message buttons
├── popup.html             All UI views & modals
├── popup.css              Dev.to-inspired styles (380px popup)
├── popup.js               Full SPA app logic
├── js/
│   ├── storage.js         chrome.storage.local wrapper
│   ├── eligibility.js     Dev.to API eligibility check
│   └── linkSafety.js      URL spoofing detection + safe renderer
└── icons/                 16 / 48 / 128 px PNG icons
```

---

## Features

| Feature | Details |
|---|---|
| **Account eligibility** | Checks `joined_at` & `articles_count` via the Dev.to public API. Account must be at least **30 days old** and have **at least 1 published post** before sending or receiving messages. |
| **First-contact approval** | When someone messages you for the first time, you see a banner with their opening message and must hit **Approve** or **Deny** before the conversation unlocks. |
| **Flag / report spam** | Every incoming message has a 🚩 button. Clicking it opens a reason picker (spam, phishing, harassment, inappropriate, other) and marks the message as reported. |
| **Link spoofing detection** | Before any link opens, `LinkSafety.isSpoofed()` compares the visible URL text against the actual `href` hostname. A red alert is shown if they differ. |
| **Link safety warning** | Every link in every message routes through a warning modal that displays the full destination URL before opening it in a new tab. |
| **Local storage persistence** | All conversations, approvals, flags, and user data are stored in `chrome.storage.local`. The extension must be installed and active to read messages. |
| **Message buttons on Dev.to** | The content script injects ✉ Message buttons on user profile pages and article author headers. Clicking one pre-fills the new message compose view. |
| **Unread badge** | The extension icon shows a live unread count, updated by the background service worker whenever storage changes. |

---

## How to Install (Developer Mode)

1. Open Chrome and go to `chrome://extensions`
2. Enable **Developer mode** (toggle in the top-right corner)
3. Click **Load unpacked**
4. Select the `dev_messages` folder
5. Navigate to [dev.to](https://dev.to) and log in — the extension will detect your account automatically

---

## How to Use

### Sending a message
1. Click the extension icon while on any Dev.to page
2. Click **✉️ New** in the inbox header
3. Search for a Dev.to username — the extension will verify they are eligible to receive messages
4. Write your opening message and click **Send Message Request**
5. The recipient must approve before the conversation becomes active

### Receiving a message
1. Open the extension — pending requests appear at the top of the inbox with an amber **New ✉** badge
2. Click the request to read the opening message
3. Hit **✓ Approve** to start the conversation or **✗ Deny** to decline

### Reporting a message
- Hover over any incoming message and click the 🚩 button
- Select a reason (spam, phishing, harassment, etc.) and click **Report**
- Reported messages are visually flagged in the conversation

### Clicking links safely
- Links in messages never open directly — a warning modal always appears first showing the full destination URL
- If the visible link text shows a different domain than the actual URL, a **spoofed link** alert is displayed in red

---

## Technical Notes

> **Cross-device messaging:** Because data lives in `chrome.storage.local` (scoped to a single Chrome profile), both participants currently need to share the same browser profile for messages to sync — this makes it ideal for testing or single-device use. For true cross-device messaging, replace the `sendFirstMessage` and `sendReply` calls in `popup.js` with REST API calls to a backend sync service. The storage layer is deliberately abstracted in `js/storage.js` to make that swap straightforward.

- Built with **Manifest V3**
- No inline event handlers (CSP-compliant)
- No external dependencies — vanilla JS only
- Uses the [Dev.to public API](https://developers.forem.com/api) for eligibility checks (no API key required for public user lookups)
