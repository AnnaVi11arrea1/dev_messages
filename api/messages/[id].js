const { neon } = require('@neondatabase/serverless');
const { validateUsername } = require('../../lib/validate');

module.exports = async function handler(req, res) {
  try {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'PATCH, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Username');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'PATCH') return res.status(405).json({ error: 'Method not allowed' });

    const callerCheck = validateUsername(req.headers['x-username']);
    if (callerCheck.error) return res.status(401).json({ error: callerCheck.error });
    const username = callerCheck.value;

    const { id } = req.query;
    const { flagged, flagReason } = req.body;
    const sql = neon(process.env.DATABASE_URL);

    if (flagged !== undefined) {
      await sql`UPDATE messages SET flagged = ${flagged}, flag_reason = ${flagReason || ''} WHERE id = ${id}`;
    }

    return res.json({ success: true });
  } catch (err) {
    console.error('[messages/[id]]', err);
    return res.status(500).json({ error: err.message });
  }
};
