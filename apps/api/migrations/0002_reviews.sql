CREATE TABLE comment_reviews (
  comment_id INTEGER PRIMARY KEY REFERENCES comments(id),
  decision TEXT NOT NULL CHECK (decision IN ('approved','rejected')),
  reviewed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TRIGGER apply_comment_review AFTER INSERT ON comment_reviews
BEGIN
  UPDATE comments SET status = NEW.decision WHERE id = NEW.comment_id;
END;

CREATE INDEX comments_pending_queue ON comments(id) WHERE status = 'pending';
