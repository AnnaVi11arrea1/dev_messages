const { neon } = require('@neondatabase/serverless');
const { validateContent, validateUsername, validateId, validateTimestamp } = require('../lib/validate');

function corsHeaders(res, methods = 'GET, POST, OPTIONS') {
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
      WHERE ${username} = ANY(c.participants)
      GROUP BY c.id
      ORDER BY c.last_activity DESC
    `;

    const result = {};
    for (const row of rows) result[row.id] = rowToConv(row);
    return res.json(result);
  }

  if (req.method === 'POST') {
    const { id, participants, initiator, status, messages, lastActivity, participantData } = req.body;

    /* Validate participants are valid usernames */
    if (!Array.isArray(participants) || participants.length !== 2)
      return res.status(400).json({ error: 'participants must be an array of 2 usernames.' });
    for (const p of participants) {
      const check = validateUsername(p);
      if (check.error) return res.status(400).json({ error: `Invalid participant: ${check.error}` });
    }

    if (!participants.includes(username))
      return res.status(403).json({ error: 'Not a participant' });

    /* Check if recipient has blocked the initiator */
    const recipient = participants.find((p) => p !== username);
    const blockRow  = await sql`
      SELECT 1 FROM blocks WHERE blocker = ${recipient} AND blocked = ${username} LIMIT 1
    `;
    if (blockRow.length > 0)
      return res.status(403).json({ error: 'blocked' });

    /* Validate first message content */
    if (messages && messages.length > 0) {
      const contentCheck = validateContent(messages[0].content);
      if (contentCheck.error) return res.status(400).json({ error: contentCheck.error });
      const tsCheck = validateTimestamp(messages[0].timestamp);
      if (tsCheck.error) return res.status(400).json({ error: tsCheck.error });
    }

    await sql`
      INSERT INTO conversations (id, participants, initiator, status, last_activity, participant_data)
      VALUES (
        ${id},
        ${participants},
        ${initiator},
        ${status || 'pending'},
        ${lastActivity || Date.now()},
        ${JSON.stringify(participantData || {})}
      )
      ON CONFLICT (id) DO NOTHING
    `;

    if (messages && messages.length > 0) {
      const m = messages[0];
      await sql`
        INSERT INTO messages (id, conversation_id, from_user, content, timestamp, read, flagged, flag_reason)
        VALUES (${m.id}, ${id}, ${m.from}, ${m.content}, ${m.timestamp}, false, false, '')
        ON CONFLICT (id) DO NOTHING
      `;
    }

    return res.status(201).json({ success: true });
  }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('[conversations]', err);
    return res.status(500).json({ error: err.message });
  }
};
