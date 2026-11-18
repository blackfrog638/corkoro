CREATE TABLE comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  body TEXT NOT NULL,
  email TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX comments_public_page ON comments(article_id, id)
  WHERE status = 'approved';

CREATE VIEW public_comments AS
  SELECT id, article_id AS articleId, display_name AS displayName,
         body, created_at AS createdAt
  FROM comments WHERE status = 'approved';
