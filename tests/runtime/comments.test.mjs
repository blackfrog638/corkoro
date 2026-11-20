import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import {
  listPublicComments,
  submitComment,
} from "../../dist/apps/api/src/comments.js";

import worker from "../../dist/apps/api/src/worker.js";

function database(t) {
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
  return { sqlite, db };
}

test("comment migration, submission and public keyset pages", async (t) => {
  const { sqlite, db } = database(t);
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

test("Worker routes guard writes and return only moderated public fields", async (t) => {
  const { sqlite, db } = database(t);
  const env = {
    COMMENT_ARTICLES: ["a"],
    COMMENT_LIMITER: {
      limit: async ({ key }) => ({ success: key === "192.0.2.1" }),
    },
    DB: db,
  };
  const url = "https://local.invalid/comments";
  const post = (body, ip = "192.0.2.1") =>
    worker.fetch(
      new Request(url, {
        method: "POST",
        headers: { "content-type": "application/json", "CF-Connecting-IP": ip },
        body: JSON.stringify(body),
      }),
      env,
    );
  const get = (q) => worker.fetch(new Request(url + "?" + q), env);
  const input = {
    articleId: "a",
    displayName: "Alice",
    body: "Hello",
    email: "visitor@example.org",
  };
  assert.equal((await post({ ...input, status: "approved" })).status, 400);
  assert.equal((await post({ ...input, articleId: "private" })).status, 404);
  assert.equal((await post(input, "192.0.2.2")).status, 429);
  assert.equal((await post({ ...input, body: "a".repeat(33000) })).status, 413);
  assert.equal((await post(input)).status, 202);
  assert.deepEqual(await (await get("articleId=a")).json(), { comments: [] });
  sqlite.exec("UPDATE comments SET status='approved'");
  const { comments } = await (await get("articleId=a")).json();
  assert.equal(comments.length, 1);
  assert.deepEqual(Object.keys(comments[0]).sort(), [
    "articleId",
    "body",
    "createdAt",
    "displayName",
    "id",
  ]);
  assert.equal((await get("articleId=a&limit=1&limit=2")).status, 400);
  env.COMMENT_ARTICLES = [];
  assert.equal((await get("articleId=a")).status, 404);
});
