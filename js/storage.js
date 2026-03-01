/* storage.js – chrome.storage.local for user prefs; Vercel API for messaging */

const Storage = {
  username: null, // set by popup.js after login

  /* ── Local helpers ─────────────────────────────────────────────────────── */
  async get(keys) {
    return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
  },
  async set(data) {
    return new Promise((resolve) => chrome.storage.local.set(data, resolve));
  },

  /* ── Current user (local only) ─────────────────────────────────────────── */
  async getCurrentUser() {
    const r = await this.get('currentUser');
    return r.currentUser || null;
  },
  async setCurrentUser(user) {
    await this.set({ currentUser: user });
  },

  /* ── Blocked users (local only) ────────────────────────────────────────── */
  async getBlockedUsers() {
    const r = await this.get('blockedUsers');
    return r.blockedUsers || [];
  },
  async blockUser(username) {
    const blocked = await this.getBlockedUsers();
    if (!blocked.includes(username)) {
      await this.set({ blockedUsers: [...blocked, username] });
    }
  },

  /* ── API helpers ───────────────────────────────────────────────────────── */
  _headers() {
    return { 'Content-Type': 'application/json', 'X-Username': this.username || '' };
  },
  async _api(path, options = {}) {
    const res = await fetch(`${Config.API_BASE}${path}`, {
      ...options,
      headers: this._headers(),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      let message;
      try { message = JSON.parse(body).error; } catch { message = body; }
      message = message || `HTTP ${res.status}`;
      console.error(`[API] ${options.method || 'GET'} ${path} → ${res.status}:`, message);
      throw new Error(message);
    }
    return res.json();
  },

  /* ── Conversations ─────────────────────────────────────────────────────── */
  async getConversations() {
    return this._api('/conversations');
  },
  async getConversation(id) {
    try {
      return await this._api(`/conversations/${encodeURIComponent(id)}`);
    } catch (err) {
      if (err.message.startsWith('HTTP 404') || err.message === 'Not found') return null;
      throw err;
    }
  },
  async upsertConversation(id, conv) {
    await this._api('/conversations', {
      method: 'POST',
      body: JSON.stringify(conv),
    });
  },
  async updateConversationStatus(id, status) {
    await this._api(`/conversations/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
  },
  async markConversationRead(id) {
    await this._api(`/conversations/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ markRead: true }),
    });
  },

  /* ── Messages ──────────────────────────────────────────────────────────── */
  async addMessage(convId, message) {
    await this._api('/messages', {
      method: 'POST',
      body: JSON.stringify({ ...message, conversationId: convId }),
    });
  },
  async updateMessage(convId, msgId, patch) {
    await this._api(`/messages/${encodeURIComponent(msgId)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
  },

  /* ── Helpers ───────────────────────────────────────────────────────────── */
  convId(user1, user2) {
    return [user1, user2].sort().join(':');
  },
  generateId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  },
};

