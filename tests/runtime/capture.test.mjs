import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { envelopeSchema } from "../../dist/packages/content-contract/src/index.js";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { captureContent } from "../../dist/packages/publisher/src/index.js";
import { buildSite, readSite } from "../../dist/apps/web/src/index.js";
test(
  "capture stays read-only and site renders the captured snapshot after Vault changes",
  { skip: process.platform !== "win32" },
  async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "corkoro-capture-"));
    const vault = path.join(root, "vault");
    try {
      await fs.cp(new URL("../fixtures/vault", import.meta.url), vault, {
        recursive: true,
      });
      const config = path.join(vault, "网站/selected.config.json");
      const c = JSON.parse(await fs.readFile(config, "utf8"));
      c.output.directory = path.join(root, "output");
      await fs.writeFile(config, JSON.stringify(c));
      const before = await fs.readFile(config);
      const captured = await captureContent(config);
      assert.deepEqual(await fs.readFile(config), before);
      await assert.rejects(fs.stat(captured.outputDirectory), {
        code: "ENOENT",
      });
      const cli = path.resolve("dist/tools/cli/src/main.js");
      for (const cwd of [root, vault]) {
        const { stdout } = await promisify(execFile)(
          process.execPath,
          [cli, "build", "--config", config, "--json"],
          { cwd },
        );
        const response = envelopeSchema.parse(JSON.parse(stdout));
        assert.equal(response.ok, true, stdout);
        const bundle = JSON.parse(
          await fs.readFile(
            path.join(response.data.siteDirectory, "content.bundle.json"),
            "utf8",
          ),
        );
        assert.equal(bundle.buildId, captured.bundle.buildId);
        assert.equal(response.configVersion, captured.configVersion);
      }
      await fs.rename(vault, path.join(root, "offline"));
      const expected = captured.bundle.buildId;
      const pending = buildSite(captured.bundle, captured.outputDirectory);
      captured.bundle.manifest.site.title = "MUTATED_AFTER_CALL";
      const result = await pending;
      assert.equal(result.ok, true, JSON.stringify(result));
      assert.equal(
        (await readSite(captured.outputDirectory)).buildId,
        expected,
      );
      assert.doesNotMatch(
        await fs.readFile(
          path.join(result.siteDirectory, "index.html"),
          "utf8",
        ),
        /MUTATED_AFTER_CALL/,
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  },
);
