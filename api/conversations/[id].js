const { neon } = require('@neondatabase/serverless');
const { validateContent, validateUsername, validateId, validateTimestamp } = require('../../lib/validate');

function corsHeaders(res, methods = 'GET, PATCH, OPTIONS') {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', methods);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Username');
}

function rowToConv(row) {
  return {
    id:              row.id,
    participants:    row.participants,
    initiator:       row.initiator,
    status:          row.status,
    lastActivity:    Number(row.last_activity || 0),
    participantData: typeof row.participant_data === 'string'
                       ? JSON.parse(row.participant_data)
                       : (row.participant_data || {}),
    messages: (row.messages || []).map((m) => ({
      id:         m.id,
      from:       m.from_user,
      content:    m.content,
      timestamp:  Number(m.timestamp),
      read:       m.read,
      flagged:    m.flagged,
      flagReason: m.flag_reason,
    })),
  };
}

module.exports = async function handler(req, res) {
  try {
    corsHeaders(res);
    if (req.method === 'OPTIONS') return res.status(200).end();

  const callerCheck = validateUsername(req.headers['x-username']);
  if (callerCheck.error) return res.status(401).json({ error: callerCheck.error });
  const username = callerCheck.value;

  const { id } = req.query;
  const sql = neon(process.env.DATABASE_URL);

  if (req.method === 'GET') {
    const rows = await sql`
      SELECT
        c.id, c.participants, c.initiator, c.status, c.last_activity, c.participant_data,
        COALESCE(
          json_agg(
            json_build_object(
              'id',         m.id,
              'from_user',  m.from_user,
              'content',    m.content,
              'timestamp',  m.timestamp,
              'read',       m.read,
              'flagged',    m.flagged,
              'flag_reason',m.flag_reason
            ) ORDER BY m.timestamp ASC
          ) FILTER (WHERE m.id IS NOT NULL),
          '[]'::json
        ) AS messages
      FROM conversations c
      LEFT JOIN messages m ON m.conversation_id = c.id
      WHERE c.id = ${id} AND ${username} = ANY(c.participants)
      GROUP BY c.id
    `;
    if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
    return res.json(rowToConv(rows[0]));
  }

  if (req.method === 'PATCH') {
    const check = await sql`SELECT participants FROM conversations WHERE id = ${id}`;
    if (check.length === 0 || !check[0].participants.includes(username))
      return res.status(403).json({ error: 'Forbidden' });

    const { status, markRead, hideFor } = req.body;

    if (hideFor) {
      /* Soft-delete: add caller to hidden_for so it disappears only for them */
      await sql`
        UPDATE conversations
        SET hidden_for = array_append(hidden_for, ${username})
        WHERE id = ${id} AND NOT (${username} = ANY(hidden_for))
      `;
    }
    if (status) {
      await sql`UPDATE conversations SET status = ${status} WHERE id = ${id}`;
    }
    if (markRead) {
      await sql`
        UPDATE messages SET read = true
        WHERE conversation_id = ${id} AND from_user != ${username}
      `;
    }
    return res.json({ success: true });
  }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('[conversations/[id]]', err);
    return res.status(500).json({ error: err.message });
  }
};
