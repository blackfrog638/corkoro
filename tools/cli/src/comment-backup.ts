import { DatabaseSync } from "node:sqlite";
import {
  readFileSync,
  writeFileSync,
  openSync,
  closeSync,
  linkSync,
  lstatSync,
  unlinkSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";
import { commentBackup } from "../../../packages/api-contract/src/comment-backup.js";

function capture(path: string) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    db.exec("BEGIN");
    const comments = db
      .prepare(
        `SELECT c.id,article_id AS articleId,display_name AS displayName,
 body,email,status,created_at AS createdAt,decision,reviewed_at AS reviewedAt FROM comments c
 LEFT JOIN comment_reviews r ON r.comment_id=c.id ORDER BY c.id`,
      )
      .all();
    const sequence =
      db.prepare("SELECT seq FROM sqlite_sequence WHERE name='comments'").get()
        ?.seq ?? 0;
    if (db.prepare("PRAGMA foreign_key_check(comment_reviews)").get())
      throw new Error();
    return commentBackup.parse({
      format: "corkoro-comments-v1",
      sequence,
      comments,
    });
  } finally {
    db.close();
  }
}

function restore(path: string, data: ReturnType<typeof capture>) {
  const db = new DatabaseSync(path);
  try {
    db.exec("BEGIN");
    for (const name of ["0001_comments", "0002_reviews"])
      db.exec(
        readFileSync(
          new URL(
            "../../../apps/api/migrations/" + name + ".sql",
            import.meta.url,
          ),
          "utf8",
        ),
      );
    const insert = db.prepare(
      "INSERT INTO comments(id,article_id,display_name,body,email,status,created_at) VALUES(?,?,?,?,?,?,?)",
    );
    const audit = db.prepare(
      "INSERT INTO comment_reviews(comment_id,decision,reviewed_at) VALUES(?,?,?)",
    );
    for (const row of data.comments) {
      insert.run(
        row.id,
        row.articleId,
        row.displayName,
        row.body,
        row.email,
        row.status,
        row.createdAt,
      );
      if (row.decision !== null)
        audit.run(row.id, row.decision, row.reviewedAt);
    }
    db.exec("DELETE FROM sqlite_sequence WHERE name='comments'");
    db.prepare(
      "INSERT INTO sqlite_sequence(name,seq) VALUES('comments',?)",
    ).run(data.sequence);
    db.exec("COMMIT");
  } finally {
    db.close();
  }
}

export async function runBackup(args: string[]) {
  const [action, ...rest] = args;
  const command = "comments " + action;
  let db, file;
  try {
    const { values, tokens } = parseArgs({
      args: rest,
      options: {
        db: { type: "string" },
        file: { type: "string" },
        json: { type: "boolean" },
      },
      tokens: true,
    });
    if (
      tokens.some(
        (t, i) =>
          t.kind !== "option" ||
          tokens
            .slice(0, i)
            .some((other) => other.kind === "option" && other.name === t.name),
      )
    )
      throw new Error();
    db = values.db;
    file = values.file;
    if (
      !db ||
      !file ||
      ![db, file].every((p) => p !== ":memory:" && !p.startsWith("file:"))
    )
      throw new Error();
  } catch {
    return { command, ok: false, exitCode: 2, error: "INVALID_ARGUMENT" };
  }
  const exporting = action === "export";
  const target = exporting ? file : db;
  const temp = target + "." + randomUUID() + ".tmp";
  let owned = false;
  try {
    const data = exporting
      ? capture(db)
      : commentBackup.parse(JSON.parse(readFileSync(file, "utf8")));
    closeSync(openSync(temp, "wx", 0o600));
    owned = true;
    if (exporting) writeFileSync(temp, JSON.stringify(data));
    else restore(temp, data);
    if (
      !exporting &&
      ["-wal", "-shm", "-journal"].some((suffix) =>
        lstatSync(target + suffix, { throwIfNoEntry: false }),
      )
    )
      throw new Error();
    linkSync(temp, target);
    return { command, ok: true, exitCode: 0, count: data.comments.length };
  } catch {
    return { command, ok: false, exitCode: 4, error: "BACKUP_FAILED" };
  } finally {
    if (owned) unlinkSync(temp);
  }
}
