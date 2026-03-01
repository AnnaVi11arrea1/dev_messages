/* eligibility.js – Dev.to account requirements check */

const Eligibility = {
  MIN_DAYS: 30,
  MIN_POSTS: 1,

  async check(username) {
    try {
      const res = await fetch(
        `https://dev.to/api/users/by_username?url=${encodeURIComponent(username)}`
      );
      if (!res.ok) {
        if (res.status === 404)
          return { eligible: false, error: 'User not found on Dev.to.' };
        return { eligible: false, error: `Dev.to API error (${res.status}).` };
      }

      const user = await res.json();

      const joinDate = new Date(user.joined_at || user.created_at);
      const daysSince = Math.floor(
        (Date.now() - joinDate.getTime()) / (1000 * 60 * 60 * 24)
      );
      const accountOldEnough = daysSince >= this.MIN_DAYS;

      /* articles_count is not returned by the by_username endpoint;
         fall back to querying the articles API directly. */
      let articlesCount = user.articles_count || 0;
      if (articlesCount === 0) {
        try {
          const artRes = await fetch(
            `https://dev.to/api/articles?username=${encodeURIComponent(user.username || username)}&per_page=1&state=fresh`
          );
          if (artRes.ok) {
            const arts = await artRes.json();
            /* If fresh feed is empty, also try the published feed */
            if (arts.length === 0) {
              const artRes2 = await fetch(
                `https://dev.to/api/articles?username=${encodeURIComponent(user.username || username)}&per_page=1`
              );
              if (artRes2.ok) {
                const arts2 = await artRes2.json();
                articlesCount = arts2.length > 0 ? arts2.length : 0;
              }
            } else {
              articlesCount = arts.length;
            }
          }
        } catch { /* network error – keep 0 */ }
      }
      const hasPost = articlesCount >= this.MIN_POSTS;

      return {
        eligible: accountOldEnough && hasPost,
        accountOldEnough,
        daysSince,
        hasPost,
        articlesCount,
        name: user.name,
        username: user.username,
        profileImage: user.profile_image_90 || user.profile_image || '',
      };
    } catch (err) {
      return { eligible: false, error: err.message };
    }
  },
};
