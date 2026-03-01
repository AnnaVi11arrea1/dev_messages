/* linkSafety.js – URL spoofing detection and safe content rendering */

const LinkSafety = {
  /**
   * Returns true if displayText looks like a URL but points to a
   * different hostname than href (classic phishing trick).
   */
  isSpoofed(displayText, href) {
    const looksLikeUrl = /^https?:\/\//i.test(displayText.trim());
    if (!looksLikeUrl) return false;
    try {
      const shownHost = new URL(displayText.trim()).hostname.toLowerCase();
      const realHost = new URL(href).hostname.toLowerCase();
      return shownHost !== realHost;
    } catch {
      return false;
    }
  },

  escapeHtml(text) {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  },

  /**
   * Converts plain-text message content into safe HTML.
   * URLs are wrapped in clickable elements that trigger the safety modal
   * instead of navigating directly; no inline handlers are used.
   */
  renderContent(text) {
    /* GIF / meme messages */
    if (/^\[gif\]:https?:\/\//i.test(text)) {
      const url = this.escapeHtml(text.slice(6));
      return `<img class="msg-gif" src="${url}" alt="meme" loading="lazy" />`;
    }

    const escaped = this.escapeHtml(text);
    const urlRegex = /(https?:\/\/[^\s<>"&]+)/gi;
    return escaped.replace(urlRegex, (url) => {
      const encoded = encodeURIComponent(url);
      return `<a href="#" class="msg-link" data-url="${encoded}">🔗 ${url}</a>`;
    });
  },
};
