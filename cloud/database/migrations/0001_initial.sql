-- Initial Lucky Cloud schema. Apply only to the Cloudflare D1 database.
-- This does not read, alter, or migrate the local SQLite database.
PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  password_iterations INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  csrf_token TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX sessions_user_id ON sessions(user_id);
CREATE TABLE auth_attempts (
  key TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL,
  window_started_at INTEGER NOT NULL,
  blocked_until INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE missions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  goal TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  created_at TEXT NOT NULL
);
CREATE INDEX missions_user_created ON missions(user_id, created_at);
CREATE TABLE memories (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  content TEXT NOT NULL,
  confidence TEXT NOT NULL,
  source TEXT NOT NULL,
  tags_json TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX memories_user_created ON memories(user_id, created_at);
CREATE TABLE experiences (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  context TEXT NOT NULL,
  action TEXT NOT NULL,
  result TEXT NOT NULL,
  confidence TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX experiences_user_created ON experiences(user_id, created_at);
CREATE TABLE learning_insights (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  fingerprint TEXT NOT NULL,
  category TEXT NOT NULL,
  summary TEXT NOT NULL,
  occurrences INTEGER NOT NULL,
  evidence_ids_json TEXT NOT NULL,
  confidence TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, fingerprint)
);
CREATE TABLE approvals (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tool TEXT NOT NULL,
  arguments_json TEXT NOT NULL,
  context TEXT NOT NULL,
  action_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'consumed', 'expired')),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  decided_at TEXT,
  consumed_at TEXT
);
CREATE INDEX approvals_user_status ON approvals(user_id, status, created_at);
CREATE TABLE audit_heads (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL,
  hash TEXT NOT NULL
);
CREATE TABLE audit_log (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  kind TEXT NOT NULL,
  subject TEXT NOT NULL,
  summary TEXT NOT NULL,
  previous_hash TEXT NOT NULL,
  hash TEXT NOT NULL,
  PRIMARY KEY (user_id, sequence)
);
CREATE INDEX audit_user_sequence ON audit_log(user_id, sequence);
CREATE TABLE user_settings (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'none' CHECK (provider IN ('none', 'cloudflare-ai')),
  model TEXT NOT NULL DEFAULT '@cf/meta/llama-3.1-8b-instruct-fast',
  updated_at TEXT NOT NULL
);
CREATE TABLE chat_messages (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX chat_user_created ON chat_messages(user_id, created_at);
