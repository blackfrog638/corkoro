import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { envelopeSchema } from "../../dist/packages/content-contract/src/index.js";
import { readSite } from "../../dist/apps/web/src/index.js";

assert.equal(
  process.platform,
  "win32",
  "Site verification requires Windows NTFS",
);
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
