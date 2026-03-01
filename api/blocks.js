const { neon } = require('@neondatabase/serverless');
const { validateUsername } = require('../lib/validate');

function corsHeaders(res, methods = 'GET, POST, DELETE, OPTIONS') {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', methods);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Username');
}

module.exports = async function handler(req, res) {
  try {
    corsHeaders(res);
    if (req.method === 'OPTIONS') return res.status(200).end();

    const callerCheck = validateUsername(req.headers['x-username']);
    if (callerCheck.error) return res.status(401).json({ error: callerCheck.error });
    const username = callerCheck.value;

    const sql = neon(process.env.DATABASE_URL);

    /* GET – list everyone this user has blocked */
    if (req.method === 'GET') {
      const rows = await sql`
        SELECT blocked, created_at FROM blocks WHERE blocker = ${username} ORDER BY created_at DESC
      `;
      return res.json(rows.map((r) => ({ username: r.blocked, createdAt: Number(r.created_at) })));
    }

    /* POST { blocked } – block a user */
    if (req.method === 'POST') {
      const check = validateUsername(req.body?.blocked);
      if (check.error) return res.status(400).json({ error: check.error });
      const target = check.value;
      if (target === username) return res.status(400).json({ error: 'Cannot block yourself.' });

      await sql`
        INSERT INTO blocks (blocker, blocked) VALUES (${username}, ${target})
        ON CONFLICT DO NOTHING
      `;
      return res.json({ success: true });
    }

    /* DELETE ?blocked=username – unblock a user */
    if (req.method === 'DELETE') {
      const check = validateUsername(req.query?.blocked);
      if (check.error) return res.status(400).json({ error: check.error });
      const target = check.value;

      await sql`DELETE FROM blocks WHERE blocker = ${username} AND blocked = ${target}`;
      return res.json({ success: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('[blocks]', err);
    return res.status(500).json({ error: err.message });
  }
};
