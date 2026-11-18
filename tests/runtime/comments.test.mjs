import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import {
  listPublicComments,
  submitComment,
} from "../../dist/apps/api/src/comments.js";

test("comment migration, submission and public keyset pages", async (t) => {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  sqlite.exec(
    readFileSync(
      new URL("../../apps/api/migrations/0001_comments.sql", import.meta.url),
      "utf8",
    ),
  );
  const db = {
    prepare(sql) {
      const stmt = sqlite.prepare(sql);
      return {
        bind(...values) {
          return {
            run: async () => stmt.run(...values),
            all: async () => ({ results: stmt.all(...values) }),
          };
        },
      };
    },
  };
  const input = {
    articleId: "article-1",
    displayName: " 匿名 ",
    body: "访客原文 ' ?",
    email: "example@example.org",
  };
  for (const invalid of [
    { status: "approved" },
    { body: " " },
    { email: "invalid" },
    { articleId: "../outside" },
  ])
    await assert.rejects(submitComment(db, { ...input, ...invalid }));
  await submitComment(db, input);
  assert.deepEqual(
    await listPublicComments(db, { articleId: input.articleId }),
    [],
  );
  assert.equal(
    sqlite.prepare("SELECT status FROM comments").get().status,
    "pending",
  );
  await submitComment(db, { ...input, email: undefined });
  await submitComment(db, { ...input, articleId: "article-2" });
  await submitComment(db, input);
  sqlite.exec(
    "UPDATE comments SET status='approved' WHERE id <= 3; UPDATE comments SET status='rejected' WHERE id=4",
  );
  const [first] = await listPublicComments(db, {
    articleId: input.articleId,
    limit: 1,
  });
  assert.deepEqual(first, {
    id: 1,
    articleId: input.articleId,
    displayName: "匿名",
    body: input.body,
    createdAt: first.createdAt,
  });
  const rest = await listPublicComments(db, {
    articleId: input.articleId,
    after: first.id,
  });
  assert.deepEqual(
    rest.map((c) => c.id),
    [2],
  );
  await assert.rejects(
    listPublicComments(db, { articleId: input.articleId, limit: 0 }),
  );
});
