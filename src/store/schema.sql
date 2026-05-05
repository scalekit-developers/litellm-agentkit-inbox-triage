CREATE TABLE IF NOT EXISTS cursor (
  id          INTEGER PRIMARY KEY CHECK (id = 1),
  last_seen_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS proposals (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id       TEXT NOT NULL UNIQUE,
  subject         TEXT NOT NULL,
  from_address    TEXT NOT NULL DEFAULT '',
  classification  TEXT NOT NULL,  -- JSON: ClassifyResult
  route           TEXT NOT NULL,  -- JSON: RouteResult
  research        TEXT NOT NULL,  -- JSON: ResearchResult
  drafts          TEXT NOT NULL,  -- JSON: DraftResult
  status          TEXT NOT NULL DEFAULT 'pending',  -- pending | approved | rejected
  slack_ts        TEXT,
  created_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS actions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  proposal_id   INTEGER NOT NULL REFERENCES proposals(id),
  github_url    TEXT,
  email_sent    INTEGER NOT NULL DEFAULT 0,
  slack_updated INTEGER NOT NULL DEFAULT 0,
  acted_at      TEXT NOT NULL
);
