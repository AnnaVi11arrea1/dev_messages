/* gifPicker.js – Fetches meme images from Ben Halpern's Meme Monday posts,
   including every image posted in the comments (community memes). */

const GifPicker = {
  _cache: null,

  async fetchImages() {
    if (this._cache) return this._cache;

    /* ── Step 1: collect all Meme Monday articles ─────────────────────────── */
    const articles = [];
    for (let page = 1; page <= 6; page++) {
      try {
        const res = await fetch(
          `https://dev.to/api/articles?username=ben&per_page=100&page=${page}`
        );
        if (!res.ok) break;
        const data = await res.json();
        if (!data.length) break;
        for (const a of data) {
          if (/meme\s+monday/i.test(a.title)) articles.push(a);
        }
        if (data.length < 100) break;
      } catch { break; }
    }

    /* ── Step 2: collect images with dedup ────────────────────────────────── */
    const seen   = new Set();
    const images = [];
    const add    = (url, title) => {
      if (!url || seen.has(url)) return;
      seen.add(url);
      images.push({ url, title });
    };

    /* Cover images first so they appear at the top of the grid */
    for (const a of articles) {
      if (a.cover_image) add(a.cover_image, a.title);
    }

    /* ── Step 3: fetch all comment threads in parallel ────────────────────── */
    const commentThreads = await Promise.all(
      articles.map(a =>
        fetch(`https://dev.to/api/comments?a_id=${a.id}`)
          .then(r => r.ok ? r.json() : [])
          .catch(() => [])
      )
    );

    for (let i = 0; i < articles.length; i++) {
      this._extractImages(commentThreads[i], articles[i].title, add);
    }

    this._cache = images;
    return images;
  },

  /* Recursively walk comment tree and pull every <img src="…"> */
  _extractImages(comments, articleTitle, add) {
    for (const comment of comments) {
      const matches = (comment.body_html || '').matchAll(/<img[^>]+src="([^"]+)"/gi);
      for (const m of matches) add(m[1], articleTitle);
      if (comment.children?.length) {
        this._extractImages(comment.children, articleTitle, add);
      }
    }
  },
};
