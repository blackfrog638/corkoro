import test from "node:test";
import assert from "node:assert/strict";
import { status } from "../../dist/tools/cli/src/status.js";

const expected = "a".repeat(40);
const old = "b".repeat(40);
const request = {
  command: "status",
  repository: "example/blog",
  branch: "gh-pages",
  expected,
};
for (const [latest, state, liveCommit] of [
  ["success", "live", expected],
  ["queued", "pending", old],
  ["failure", "failed", old],
  ["inactive", "superseded", old],
]) {
  test("Pages deployment " + latest, async () => {
    const records = [expected, old].map((sha, id) => ({
      id: id + 1,
      sha,
      ref: "gh-pages",
      environment: "github-pages",
    }));
    const get = async (url) =>
      Response.json(
        url.includes("?environment=")
          ? records
          : [{ state: url.includes("/1/") ? latest : "success" }],
      );
    const result = await status(request, new AbortController().signal, get);
    assert.equal(result.data.state, state);
    assert.equal(result.data.liveCommit, liveCommit);
  });
}
test("Pages access denied reports query failure", async () => {
  await assert.rejects(
    status(
      request,
      new AbortController().signal,
      async () => new Response(null, { status: 403 }),
    ),
    { code: "PAGES_QUERY_FAILED", exitCode: 4 },
  );
});
test("Pages record on another branch does not confirm target", async () => {
  const get = async (url) =>
    Response.json(
      url.includes("?environment=")
        ? [{ id: 1, sha: expected, ref: "main", environment: "github-pages" }]
        : [{ state: "success" }],
    );
  const result = await status(request, new AbortController().signal, get);
  assert.equal(result.data.state, "unknown");
});
