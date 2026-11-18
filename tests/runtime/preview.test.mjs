import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { once } from "node:events";
import { envelopeSchema } from "../../dist/packages/content-contract/src/index.js";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { hash } from "../../dist/packages/publisher/src/files.js";

test("preview serves only verified committed files at their base and stays on captured bytes", async (t) => {
  const { startPreview } = await import("../../dist/apps/web/src/preview.js");
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "corkoro-preview-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const generation = "corkoro-site-12345678-1234-4234-8234-123456789abc";
  const site = path.join(root, generation, "site");
  await fs.mkdir(site, { recursive: true });
  const files = {
    "index.html": "<h1>public</h1>",
    "中文/index.html": "中文",
    "content.bundle.json": JSON.stringify({
      manifest: { site: { address: { base: "/blog/" } } },
    }),
  };
  for (const [name, body] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(site, name)), { recursive: true });
    await fs.writeFile(path.join(site, name), body);
  }
  await fs.writeFile(
    path.join(root, "site.current.json"),
    JSON.stringify({
      format: "corkoro-site",
      schemaVersion: 1,
      generation,
      buildId: "sha256:" + "a".repeat(64),
      files: Object.entries(files)
        .map(([name, body]) => ({ path: name, hash: hash(Buffer.from(body)) }))
        .sort((a, b) => (a.path < b.path ? -1 : 1)),
    }),
  );
  const preview = await startPreview(root, 0);
  t.after(() => preview.close());
  await assert.rejects(startPreview(root, Number(new URL(preview.url).port)), {
    code: "EADDRINUSE",
  });
  await assert.rejects(startPreview(root, -1), { code: "INVALID_ARGUMENT" });
  await assert.rejects(startPreview(root, 65536), { code: "INVALID_ARGUMENT" });
  assert.equal(await (await fetch(preview.url)).text(), "<h1>public</h1>");
  assert.equal(
    await (await fetch(preview.url + "%E4%B8%AD%E6%96%87/")).text(),
    "中文",
  );
  for (const name of [
    "site.current.json",
    "../site.current.json",
    "%2e%2e%5csite.current.json",
    "missing",
  ])
    assert.equal((await fetch(preview.url + name)).status, 404);
  assert.equal((await fetch(preview.url, { method: "POST" })).status, 405);
  assert.equal((await fetch(preview.url, { method: "HEAD" })).status, 200);
  const child = spawn(
    process.execPath,
    [
      path.resolve("dist/tools/cli/src/main.js"),
      "preview",
      "--out-dir",
      root,
      "--port",
      "0",
      "--json",
    ],
    { cwd: root, windowsHide: true },
  );
  t.after(() => child.kill());
  const lines = createInterface({ input: child.stdout });
  const [line] = await once(lines, "line");
  const result = envelopeSchema.parse(JSON.parse(line));
  assert.equal(result.command, "preview");
  assert.equal(await (await fetch(result.data.url)).text(), "<h1>public</h1>");
  child.kill();
  await once(child, "close");
  await fs.writeFile(path.join(site, "index.html"), "modified");
  assert.equal(await (await fetch(preview.url)).text(), "<h1>public</h1>");
  await assert.rejects(startPreview(root, 0));
});
