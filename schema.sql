-- Run this in your Neon SQL editor to set up the database schema.

CREATE TABLE IF NOT EXISTS conversations (
  id               TEXT PRIMARY KEY,
  participants     TEXT[]  NOT NULL,
  initiator        TEXT    NOT NULL,
  status           TEXT    NOT NULL DEFAULT 'pending',
  last_activity    BIGINT  NOT NULL DEFAULT 0,
  participant_data JSONB   NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS messages (
  id              TEXT    PRIMARY KEY,
  conversation_id TEXT    NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  from_user       TEXT    NOT NULL,
  content         TEXT    NOT NULL,
  timestamp       BIGINT  NOT NULL,
  read            BOOLEAN NOT NULL DEFAULT FALSE,
  flagged         BOOLEAN NOT NULL DEFAULT FALSE,
  flag_reason     TEXT    NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_conv_participants ON conversations USING GIN (participants);
CREATE INDEX IF NOT EXISTS idx_msg_conv_id       ON messages (conversation_id);
