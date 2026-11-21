import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  rmSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

test("CLI restores a consistent private archive to a fresh database", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "comments-backup-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = (name) => join(dir, name);
  const source = new DatabaseSync(path("source"));
  for (const name of ["0001_comments", "0002_reviews"])
    source.exec(
      readFileSync(
        new URL("../../apps/api/migrations/" + name + ".sql", import.meta.url),
        "utf8",
      ),
    );
  for (const id of [1, 2, 3, 8])
    source
      .prepare(
        "INSERT INTO comments(id,article_id,display_name,body,email) VALUES(?, 'stable','访客','留言','private@example.org')",
      )
      .run(id);
  source.exec(
    "INSERT INTO comment_reviews(comment_id,decision) VALUES (2,'approved'),(3,'rejected'); DELETE FROM comments WHERE id=8",
  );
  source.close();
  const cli = fileURLToPath(
    new URL("../../dist/tools/cli/src/main.js", import.meta.url),
  );
  function run(action, db, file, code = 0) {
    const r = spawnSync(
      process.execPath,
      [
        cli,
        "comments",
        action,
        "--db",
        path(db),
        "--file",
        path(file),
        "--json",
      ],
      { encoding: "utf8" },
    );
    assert.equal(r.status, code, r.stdout + r.stderr);
    assert.equal(JSON.parse(r.stdout).exitCode, code);
    assert.ok(!r.stdout.includes("private@example.org"));
  }
  run("export", "source", "backup");
  run("export", "source", "backup", 4);
  run("restore", "restored", "backup");
  run("restore", "restored", "backup", 4);
  run("export", "restored", "again");
  assert.deepEqual(
    JSON.parse(readFileSync(path("again"))),
    JSON.parse(readFileSync(path("backup"))),
  );
  const db = new DatabaseSync(path("restored"));
  assert.deepEqual(
    db
      .prepare("SELECT id FROM public_comments")
      .all()
      .map((r) => r.id),
    [2],
  );
  assert.equal(
    db
      .prepare(
        "INSERT INTO comments(article_id,display_name,body) VALUES('stable','a','b')",
      )
      .run().lastInsertRowid,
    9,
  );
  db.close();
  const invalid = JSON.parse(readFileSync(path("backup")));
  invalid.comments[1].decision = "rejected";
  writeFileSync(path("bad"), JSON.stringify(invalid));
  run("restore", "absent", "bad", 4);
  assert.equal(existsSync(path("absent")), false);
  writeFileSync(path("stale-wal"), "orphan");
  run("restore", "stale", "backup", 4);
  assert.equal(existsSync(path("stale")), false);
});
