import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { sealDeployment } from "../../dist/packages/content-contract/src/deployment.js";

test("compare static files to a pinned local branch without touching the checkout", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "corkoro-compare-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const repo = path.join(root, "博客");
  await fs.mkdir(repo);
  const git = (...args) =>
    execFileSync("git", ["-C", repo, ...args], {
      encoding: "utf8",
      windowsHide: true,
    }).trim();
  git("init", "-q", "-b", "blog");
  for (const [name, body] of Object.entries({
    "index.html": "old",
    CNAME: "example.org",
    "old.html": "history",
    "same.txt": "same",
    blocked: "file",
  }))
    await fs.writeFile(path.join(repo, name), body);
  git("add", ".");
  git(
    "-c",
    "user.name=test",
    "-c",
    "user.email=test@example.invalid",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-qm",
    "fixture",
  );
  const commit = git("rev-parse", "HEAD");
  await fs.writeFile(path.join(repo, "index.html"), "new");
  const before = git("status", "--porcelain");
  const input = path.join(root, "snapshot.json");
  const run = (...args) =>
    spawnSync(
      process.execPath,
      [
        fileURLToPath(
          new URL("../../tools/deployment/compare.mjs", import.meta.url),
        ),
        ...args,
      ],
      { encoding: "utf8", windowsHide: true },
    );
  for (const blocked of [false, true]) {
    const files = Object.entries({
      "index.html": "new",
      "same.txt": "same",
      "文章.html": "article",
      ...(blocked ? { "blocked/child": "x", CNAME: "changed" } : {}),
    }).map(([path, body]) => ({
      path,
      hash: "sha256:" + createHash("sha256").update(body).digest("hex"),
      base64: Buffer.from(body).toString("base64"),
    }));
    await fs.writeFile(
      input,
      JSON.stringify(
        sealDeployment({
          format: "corkoro-deployment",
          schemaVersion: 1,
          buildId: "sha256:" + "0".repeat(64),
          base: "/",
          files,
        }),
      ),
    );
    const response = run(input, repo, "blog");
    assert.equal(response.status, blocked ? 3 : 0, response.stderr);
    const data = JSON.parse(response.stdout);
    assert.equal(data.commit, commit);
    assert.deepEqual(data.update, ["index.html"]);
    assert.deepEqual(data.unchanged, ["same.txt"]);
    assert.deepEqual(data.add, ["文章.html"]);
    assert.ok(data.preserve.includes("old.html"));
    assert.deepEqual(data.conflict, blocked ? ["CNAME", "blocked/child"] : []);
    if (!blocked) assert.ok(data.preserve.includes("CNAME"));
    const deploy = (branch, expected = commit, id = data.deploymentId) => {
      const child = spawnSync(
        process.execPath,
        [
          fileURLToPath(
            new URL("../../dist/tools/cli/src/main.js", import.meta.url),
          ),
          "deploy",
          "--repo",
          repo,
          "--branch",
          branch,
          "--snapshot",
          input,
          "--expected",
          expected,
          "--deployment-id",
          id,
          "--json",
        ],
        { windowsHide: true, encoding: "utf8" },
      );
      const result = JSON.parse(child.stdout);
      assert.equal(child.status, result.exitCode);
      return result;
    };
    if (!blocked) {
      git("config", "user.name", "fixture");
      git("config", "user.email", "fixture@example.invalid");
      git("branch", "publish", commit);
      assert.equal(deploy("blog").diagnostics[0].code, "BRANCH_CHECKED_OUT");
      assert.equal(
        deploy("publish", commit, "sha256:" + "f".repeat(64)).diagnostics[0]
          .code,
        "SNAPSHOT_CHANGED",
      );
      const published = deploy("publish");
      assert.equal(published.effect, "committed", JSON.stringify(published));
      assert.equal(published.data.stage, "local_commit");
      assert.equal(git("rev-parse", "publish^"), commit);
      assert.equal(git("show", "publish:index.html"), "new");
      assert.equal(git("show", "publish:文章.html"), "article");
      assert.equal(git("show", "publish:CNAME"), "example.org");
      assert.equal(git("show", "publish:old.html"), "history");
      const remote = path.join(root, "remote.git");
      git("init", "--bare", "-q", remote);
      git("push", remote, commit + ":refs/heads/publish");
      const upload = (base) =>
        spawnSync(
          process.execPath,
          [
            fileURLToPath(
              new URL("../../tools/deployment/upload.mjs", import.meta.url),
            ),
            input,
            repo,
            "publish",
            remote,
            base,
            published.data.commit,
            data.deploymentId,
          ],
          { encoding: "utf8", windowsHide: true },
        );
      const first = upload(commit);
      assert.equal(first.status, 0, first.stderr);
      assert.equal(JSON.parse(first.stdout).changed, true);
      assert.equal(JSON.parse(upload(commit).stdout).changed, false);
      assert.equal(
        JSON.parse(upload(published.data.commit).stdout).changed,
        false,
      );
      const newer = git(
        "commit-tree",
        git("rev-parse", "publish^{tree}"),
        "-p",
        published.data.commit,
        "-m",
        "another writer",
      );
      git("push", remote, newer + ":refs/heads/publish");
      const refused = upload(commit);
      assert.equal(refused.status, 4, refused.stderr);
      assert.equal(JSON.parse(refused.stderr).code, "REMOTE_BRANCH_CHANGED");
      assert.equal(
        git("ls-remote", remote, "refs/heads/publish").split("\t")[0],
        newer,
      );
      assert.equal(deploy("publish").effect, "none");
      assert.equal(git("rev-parse", "publish"), published.data.commit);
      assert.equal(
        deploy("publish", "a".repeat(40)).diagnostics[0].code,
        "BRANCH_CHANGED",
      );
    } else {
      assert.equal(deploy("publish").diagnostics[0].code, "DEPLOY_CONFLICT");
    }
  }
  assert.equal(run(input, repo, "missing").status, 1);
  assert.equal(run().status, 2);
  assert.equal(git("status", "--porcelain"), before);
  assert.equal(git("rev-parse", "HEAD"), commit);
});
