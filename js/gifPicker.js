/* gifPicker.js – Fetches cover images from Ben Halpern's Meme Monday posts */

const GifPicker = {
  _cache: null,

  async fetchImages() {
    if (this._cache) return this._cache;

    const images = [];
    for (let page = 1; page <= 6; page++) {
      try {
        const res = await fetch(
          `https://dev.to/api/articles?username=ben&per_page=100&page=${page}`
        );
        if (!res.ok) break;
        const articles = await res.json();
        if (!articles.length) break;

        for (const a of articles) {
          if (/meme\s+monday/i.test(a.title) && a.cover_image) {
            images.push({ url: a.cover_image, title: a.title });
          }
        }
        if (articles.length < 100) break;
      } catch { break; }
    }

    this._cache = images;
    return images;
  },
};
