-- Sync backend for the finger strength tracker.
--
-- Single user today. Every table carries user_id from day one so adding more
-- people later is an auth change, not a migration.

CREATE TABLE IF NOT EXISTS users (
  id         TEXT PRIMARY KEY,
  email      TEXT UNIQUE,
  label      TEXT,
  created_at INTEGER NOT NULL
);

-- Tokens are stored hashed. The plaintext is shown once at issue time and
-- never persisted, so a database dump does not hand over write access.
CREATE TABLE IF NOT EXISTS auth_tokens (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   TEXT NOT NULL UNIQUE,
  label        TEXT,
  created_at   INTEGER NOT NULL,
  last_used_at INTEGER,
  expires_at   INTEGER,
  revoked_at   INTEGER
);
CREATE INDEX IF NOT EXISTS idx_auth_tokens_user ON auth_tokens(user_id);

-- One row per synced record, whatever its kind. Storing the payload as JSON
-- keeps the app free to change its shape without a schema migration; the
-- columns that exist are the ones sync actually reasons about.
CREATE TABLE IF NOT EXISTS records (
  user_id    TEXT    NOT NULL,
  kind       TEXT    NOT NULL,   -- 'test' | 'session' | 'send' | 'settings'
  id         TEXT    NOT NULL,
  payload    TEXT    NOT NULL,   -- JSON blob owned by the client
  updated_at INTEGER NOT NULL,   -- client clock, ms. The last-write-wins key.
  deleted    INTEGER NOT NULL DEFAULT 0,
  server_seq INTEGER NOT NULL,   -- monotonic per user. What clients page on.
  PRIMARY KEY (user_id, kind, id)
);

-- Clients pull with "everything after seq N", so this index is the hot path.
CREATE INDEX IF NOT EXISTS idx_records_seq ON records(user_id, server_seq);

-- Monotonic counter per user. Deliberately NOT a timestamp: two devices with
-- skewed clocks would otherwise skip or replay each other's changes.
CREATE TABLE IF NOT EXISTS sync_state (
  user_id  TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  last_seq INTEGER NOT NULL DEFAULT 0
);
