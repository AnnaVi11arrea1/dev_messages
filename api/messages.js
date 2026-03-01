const { neon } = require('@neondatabase/serverless');
const { validateContent, validateUsername, validateId, validateTimestamp } = require('../lib/validate');

module.exports = async function handler(req, res) {
  try {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Username');
    if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const callerCheck = validateUsername(req.headers['x-username']);
  if (callerCheck.error) return res.status(401).json({ error: callerCheck.error });
  const username = callerCheck.value;

  const sql = neon(process.env.DATABASE_URL);

  /* Validate every field before touching the DB */
  const idCheck        = validateId(req.body.id);
  const convIdCheck    = validateId(req.body.conversationId);
  const fromCheck      = validateUsername(req.body.from);
  const contentCheck   = validateContent(req.body.content);
  const tsCheck        = validateTimestamp(req.body.timestamp);

  const fieldError = [idCheck, convIdCheck, fromCheck, contentCheck, tsCheck].find(r => r.error);
  if (fieldError) return res.status(400).json({ error: fieldError.error });

  /* Caller must be the stated sender */
  if (fromCheck.value !== username)
    return res.status(403).json({ error: 'Sender mismatch.' });

  const { value: id }            = idCheck;
  const { value: conversationId } = convIdCheck;
  const { value: content }        = contentCheck;
  const { value: timestamp }      = tsCheck;

  const conv = await sql`SELECT participants, status FROM conversations WHERE id = ${conversationId}`;
  if (conv.length === 0 || !conv[0].participants.includes(username))
    return res.status(403).json({ error: 'Forbidden' });
  if (conv[0].status !== 'active')
    return res.status(400).json({ error: 'Conversation not active' });

  /* Check if recipient has blocked the sender */
  const recipient = conv[0].participants.find((p) => p !== username);
  const blockRow  = await sql`
    SELECT 1 FROM blocks WHERE blocker = ${recipient} AND blocked = ${username} LIMIT 1
  `;
  if (blockRow.length > 0)
    return res.status(403).json({ error: 'blocked' });

  await sql`
    INSERT INTO messages (id, conversation_id, from_user, content, timestamp, read, flagged, flag_reason)
    VALUES (${id}, ${conversationId}, ${username}, ${content}, ${timestamp}, false, false, '')
  `;
  await sql`UPDATE conversations SET last_activity = ${timestamp} WHERE id = ${conversationId}`;

    return res.status(201).json({ success: true });
  } catch (err) {
    console.error('[messages]', err);
    return res.status(500).json({ error: err.message });
  }
};
