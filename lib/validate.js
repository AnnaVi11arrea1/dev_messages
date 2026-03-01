/* api/validate.js – input sanitisation helpers
 *
 * All SQL values already go through Neon's parameterised query driver, so
 * injection at the database layer is impossible.  These helpers add an
 * extra defence-in-depth layer: enforcing types, lengths, and stripping
 * dangerous characters before data ever reaches the DB.
 */

const MAX_MESSAGE_LENGTH  = 2000;
const MAX_USERNAME_LENGTH = 50;
const MAX_ID_LENGTH       = 64;

/** Remove null bytes and trim whitespace */
function clean(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/\0/g, '').trim();
}

/** Validate and clean a message's text content */
function validateContent(content) {
  const s = clean(content);
  if (!s) return { error: 'Message content is required.' };
  if (s.length > MAX_MESSAGE_LENGTH)
    return { error: `Message too long (max ${MAX_MESSAGE_LENGTH} chars).` };
  return { value: s };
}

/** Validate a dev.to username (alphanumeric, hyphens, underscores) */
function validateUsername(username) {
  const s = clean(username);
  if (!s) return { error: 'Username is required.' };
  if (s.length > MAX_USERNAME_LENGTH) return { error: 'Username too long.' };
  if (!/^[A-Za-z0-9_-]+$/.test(s)) return { error: 'Invalid username format.' };
  return { value: s.toLowerCase() };
}

/** Validate an opaque ID string (no special chars beyond alphanumeric, -, _, :) */
function validateId(id) {
  const s = clean(id);
  if (!s) return { error: 'ID is required.' };
  if (s.length > MAX_ID_LENGTH) return { error: 'ID too long.' };
  if (!/^[A-Za-z0-9_:.-]+$/.test(s)) return { error: 'Invalid ID format.' };
  return { value: s };
}

/** Validate a numeric timestamp */
function validateTimestamp(ts) {
  const n = Number(ts);
  if (!Number.isFinite(n) || n <= 0) return { error: 'Invalid timestamp.' };
  return { value: n };
}

module.exports = { clean, validateContent, validateUsername, validateId, validateTimestamp };
