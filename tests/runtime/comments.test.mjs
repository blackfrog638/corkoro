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
import admin from "../../dist/apps/api/src/admin.js";
import { randomBytes, createHash } from "node:crypto";

test("isolated admin entry authenticates, records a single decision and tolerates retries", async (t) => {
  const { sqlite, db } = database(t);
  sqlite.exec(
    readFileSync(
      new URL("../../apps/api/migrations/0002_reviews.sql", import.meta.url),
      "utf8",
    ),
  );
  const token = randomBytes(32).toString("base64url");
  const env = {
    DB: db,
    ADMIN_TOKEN_SHA256: createHash("sha256").update(token).digest("hex"),
  };
  function call(path = "", method = "GET", key = token, bindings = env) {
    return admin.fetch(
      new Request("https://admin.invalid/admin/comments" + path, {
        method,
        headers: { Authorization: "Bearer " + key },
      }),
      bindings,
    );
  }
  for (let i = 0; i < 2; i++)
    await submitComment(db, {
      articleId: "stable",
      body: "hello",
      displayName: "test",
      email: "private@example.org",
    });
  assert.equal((await call("", "GET", "")).status, 401);
  assert.equal(
    (await call("/1/approve", "POST", randomBytes(32).toString("base64url")))
      .status,
    401,
  );
  assert.equal((await call("", "GET", token, { DB: db })).status, 401);
  assert.equal(
    (
      await worker.fetch(new Request("https://public.invalid/admin/comments"), {
        DB: db,
      })
    ).status,
    404,
  );
  const queue = await (await call()).json();
  assert.deepEqual(
    queue.comments.map((c) => c.id),
    [1, 2],
  );
  assert.equal("email" in queue.comments[0], false);
  assert.equal((await call("/1/approve", "POST")).status, 200);
  assert.equal((await call("/1/approve", "POST")).status, 200);
  assert.equal((await call("/1/reject", "POST")).status, 409);
  assert.equal((await call("/2/reject", "POST")).status, 200);
  assert.equal((await call("/3/reject", "POST")).status, 404);
  assert.deepEqual(await (await call()).json(), { comments: [] });
  assert.deepEqual(
    (await listPublicComments(db, { articleId: "stable" })).map((c) => c.id),
    [1],
  );
  assert.deepEqual(
    sqlite
      .prepare("SELECT decision FROM comment_reviews ORDER BY comment_id")
      .all()
      .map((r) => r.decision),
    ["approved", "rejected"],
  );
});
test("missing review migration cannot publish an unaudited comment", async (t) => {
  const { db } = database(t);
  await submitComment(db, {
    articleId: "a",
    displayName: "visitor",
    body: "text",
  });
  const token = randomBytes(32).toString("base64url");
  const response = await admin.fetch(
    new Request("https://admin.invalid/admin/comments/1/approve", {
      method: "POST",
      headers: { authorization: "Bearer " + token },
    }),
    {
      DB: db,
      ADMIN_TOKEN_SHA256: createHash("sha256").update(token).digest("hex"),
    },
  );
  assert.equal(response.status, 503);
  assert.deepEqual(await listPublicComments(db, { articleId: "a" }), []);
});
