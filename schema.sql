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

CREATE TABLE IF NOT EXISTS blocks (
  blocker     TEXT   NOT NULL,
  blocked     TEXT   NOT NULL,
  created_at  BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT,
  PRIMARY KEY (blocker, blocked)
);

CREATE INDEX IF NOT EXISTS idx_conv_participants ON conversations USING GIN (participants);
CREATE INDEX IF NOT EXISTS idx_msg_conv_id       ON messages (conversation_id);
CREATE INDEX IF NOT EXISTS idx_blocks_blocker    ON blocks (blocker);

-- Run this if the conversations table already exists (adds soft-delete support):
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS hidden_for TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
-- Backfill any NULLs from before the column existed:
UPDATE conversations SET hidden_for = ARRAY[]::TEXT[] WHERE hidden_for IS NULL;
