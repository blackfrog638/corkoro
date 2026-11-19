import { captureDeployment } from "../../dist/apps/web/src/deployment.js";
import { parseDeployment } from "../../dist/packages/content-contract/src/deployment.js";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { envelopeSchema } from "../../dist/packages/content-contract/src/index.js";
import { readSite } from "../../dist/apps/web/src/index.js";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "corkoro-sites-"));
const vault = path.join(root, "vault");
await fs.cp(new URL("../../tests/fixtures/vault", import.meta.url), vault, {
  recursive: true,
});
const cli = fileURLToPath(
  new URL("../../dist/tools/cli/src/main.js", import.meta.url),
);
async function inventory(directory) {
  const files = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    assert.ok(!entry.isSymbolicLink());
    if (entry.isDirectory()) files.push(...(await inventory(target)));
    else
      files.push([
        path.relative(vault, target),
        createHash("sha256")
          .update(await fs.readFile(target))
          .digest("hex"),
      ]);
  }
  return files.sort((a, b) => a[0].localeCompare(b[0]));
}
for (const [name, expected] of [
  ["selected", 0],
  ["pages-only", 0],
  ["corkoro", 3],
  ["blocked", 3],
]) {
  const configPath = path.join(vault, "网站", `${name}.config.json`);
  const config = JSON.parse(await fs.readFile(configPath, "utf8"));
  const output = path.join(root, name);
  config.output.directory = output;
  if (name === "pages-only")
    config.site.address = { origin: "https://example.org", base: "/blog/" };
  await fs.writeFile(configPath, JSON.stringify(config));
  const before = await inventory(vault);
  let stdout,
    code = 0;
  try {
    ({ stdout } = await promisify(execFile)(
      process.execPath,
      [cli, "build", "--config", configPath, "--json"],
      { cwd: root, timeout: 120000, windowsHide: true },
    ));
  } catch (error) {
    stdout = error.stdout;
    code = error.code;
  }
  assert.equal(code, expected, stdout);
  const result = envelopeSchema.parse(JSON.parse(stdout));
  assert.equal(result.exitCode, expected);
  assert.deepEqual(await inventory(vault), before, "Build changed input files");
  if (expected === 0) {
    const site = await readSite(output);
    assert.equal(site.buildId, result.data.buildId);
    assert.ok(site.files.some((f) => f.path === "content.bundle.json"));
    assert.ok(site.files.some((f) => f.path === "pagefind/pagefind.js"));
    const snapshot = await captureDeployment(output);
    assert.equal(snapshot.buildId, site.buildId);
    const packaged = await promisify(execFile)(
      process.execPath,
      [
        fileURLToPath(new URL("../deployment/capture.mjs", import.meta.url)),
        output,
      ],
      { cwd: root, windowsHide: true, maxBuffer: 64 * 1024 * 1024 },
    );
    assert.deepEqual(parseDeployment(Buffer.from(packaged.stdout)), snapshot);
    assert.equal(packaged.stderr, "");
    assert.deepEqual(
      snapshot.files.map(({ path, hash }) => ({ path, hash })),
      site.files,
    );
    assert.deepEqual(
      parseDeployment(Buffer.from(JSON.stringify(snapshot))),
      snapshot,
    );
    assert.deepEqual(await captureDeployment(output), snapshot);
    assert.ok(
      !JSON.stringify(snapshot).includes(root),
      "Snapshot leaked local paths",
    );
    await assert.rejects(captureDeployment(output, AbortSignal.abort()), {
      code: "CANCELLED",
    });
    const child = spawn(
      process.execPath,
      [cli, "preview", "--out-dir", output, "--port", "0", "--json"],
      {
        cwd: root,
        windowsHide: true,
        stdio: ["ignore", "pipe", "inherit"],
      },
    );
    const closed = once(child, "close");
    const lines = createInterface({ input: child.stdout });
    let url;
    try {
      const first = await lines[Symbol.asyncIterator]().next();
      assert.ok(!first.done, "Preview exited before reporting its URL");
      const preview = envelopeSchema.parse(JSON.parse(first.value));
      assert.equal(preview.data.buildId, site.buildId);
      url = preview.data.url;
      assert.equal(new URL(url).pathname, config.site.address?.base ?? "/");
      for (const file of site.files) {
        const response = await fetch(
          url + file.path.split("/").map(encodeURIComponent).join("/"),
        );
        assert.equal(response.status, 200, file.path);
        const digest =
          "sha256:" +
          createHash("sha256")
            .update(Buffer.from(await response.arrayBuffer()))
            .digest("hex");
        assert.equal(digest, file.hash, file.path);
        if (file.path.endsWith(".js"))
          assert.match(response.headers.get("content-type"), /javascript/);
        if (file.path.endsWith(".svg"))
          assert.equal(response.headers.get("content-type"), "image/svg+xml");
      }
    } finally {
      lines.close();
      child.kill();
      await closed;
    }
    await assert.rejects(fetch(url));
  } else {
    assert.equal(result.effect, "none");
    await assert.rejects(fs.stat(path.join(output, "site.current.json")), {
      code: "ENOENT",
    });
  }
  console.log(`${name}: expected exit ${expected}, inputs unchanged`);
}
// Retain generated fixtures for diagnosis; never clean up an inferred user path.
console.log(`Artificial verification output: ${root}`);
