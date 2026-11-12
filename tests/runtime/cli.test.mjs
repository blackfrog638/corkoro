import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  envelopeSchema,
  configSchema,
  parseJson,
} from "../../dist/packages/content-contract/src/index.js";
import {
  openTransaction,
  execute,
} from "../../dist/packages/publisher/src/index.js";
const repo = fileURLToPath(new URL("../../", import.meta.url));
const cli = path.join(repo, "dist/tools/cli/src/main.js");
async function sandbox(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "corkoro-runtime-"));
  assert.ok(path.isAbsolute(root));
  assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
  assert.ok(path.basename(root).startsWith("corkoro-runtime-"));
  const cleanup = [];
  t.after(async () => {
    for (const f of cleanup) await f();
    await fs.rm(root, { recursive: true, force: true });
  });
  const vault = path.join(root, "中文 Vault");
  await fs.cp(path.join(repo, "tests/fixtures/vault"), vault, {
    recursive: true,
  });
  return {
    root,
    vault,
    cleanup,
    config: path.join(vault, "网站", "main.json"),
    output: path.join(root, "output"),
  };
}
async function run(args, cwd = repo) {
  const child = spawn(process.execPath, [cli, ...args, "--json"], {
    cwd,
    windowsHide: true,
  });
  let stdout = "",
    stderr = "";
  child.stdout.on("data", (b) => (stdout += b));
  child.stderr.on("data", (b) => (stderr += b));
  const timer = setTimeout(() => child.kill(), 20000);
  const [code] = await once(child, "close");
  clearTimeout(timer);
  assert.equal(stderr, "");
  let value;
  try {
    value = JSON.parse(stdout);
  } catch {
    assert.fail(`Invalid JSON result: ${stdout}, exit ${code}`);
  }
  envelopeSchema.parse(value);
  assert.equal(value.exitCode, code);
  return value;
}
async function init(s) {
  return run([
    "init",
    "--source",
    s.vault,
    "--config",
    s.config,
    "--out-dir",
    s.output,
    "--format",
    "obsidian-markdown",
  ]);
}
async function notes(vault) {
  const values = {};
  async function walk(p) {
    for (const e of await fs.readdir(p, { withFileTypes: true })) {
      if (e.name === ".corkoro-state") continue;
      const full = path.join(p, e.name);
      if (e.isDirectory()) await walk(full);
      else if (/\.(md|svg|txt)$/.test(full))
        values[path.relative(vault, full)] = createHash("sha256")
          .update(await fs.readFile(full))
          .digest("hex");
    }
  }
  await walk(vault);
  return values;
}

test("strict runtime schema rejects duplicates, unknown fields and page/article identity collisions", async () => {
  assert.throws(() => parseJson(Buffer.from('{"x":1,"\\u0078":2}')));
  assert.throws(() => parseJson(Buffer.from('{"x":1,}')));
  assert.throws(() => parseJson(Buffer.from([0xff])));
  const c = JSON.parse(
    await fs.readFile(
      path.join(repo, "tests/fixtures/vault/网站/selected.config.json"),
      "utf8",
    ),
  );
  assert.ok(configSchema.safeParse(c).success);
  assert.equal(configSchema.safeParse({ ...c, extra: true }).success, false);
  c.site.pages[0].id = c.publication.entries[0].id;
  assert.equal(configSchema.safeParse(c).success, false);
});

test("argument errors and planned commands do not touch nonexistent config", async () => {
  for (const args of [
    ["check", "--config", "missing", "--config", "other"],
    ["inspect", "--source", ".", "--format", "guess"],
    ["content", "add", "a.md", "--config", "missing"],
    ["check", "--config", "missing", "extra"],
  ]) {
    const r = await run(args);
    assert.equal(r.exitCode, 2);
    assert.equal(r.effect, "none");
  }
  const r = await run(["build", "--config", "missing"]);
  assert.equal(r.diagnostics[0].code, "UNSUPPORTED_COMMAND");
});

test("inspection reports hints without selecting content or exposing note text", async (t) => {
  const s = await sandbox(t),
    before = await notes(s.vault);
  const r = await run([
    "inspect",
    "--source",
    s.vault,
    "--format",
    "obsidian-markdown",
  ]);
  assert.equal(r.exitCode, 0);
  assert.equal(r.data.complete, true);
  assert.equal(
    r.data.inventory.find((x) => x.source === "文章/标记候选.md").publishHint,
    true,
  );
  assert.equal(JSON.stringify(r).includes("这是人工"), false);
  assert.deepEqual(await notes(s.vault), before);
  await fs.writeFile(
    path.join(s.vault, "bad.md"),
    "---\npublish: true\npublish: false\n---\ntext",
  );
  const bad = await run([
    "inspect",
    "--source",
    s.vault,
    "--format",
    "markdown",
  ]);
  assert.equal(bad.exitCode, 3);
  assert.equal(bad.data.complete, false);
});

test("plan CLI is deterministic across working directories and reports missing configuration", async (t) => {
  const s = await sandbox(t);
  const config = path.join(s.vault, "网站/selected.config.json");
  const c = JSON.parse(await fs.readFile(config, "utf8"));
  c.output.directory = s.output;
  await fs.writeFile(config, JSON.stringify(c));
  const before = await fs.readFile(config);
  const args = ["plan", "--config", config];
  const r = await run(args);
  assert.equal(r.exitCode, 0);
  assert.equal(r.data.buildable, true);
  assert.deepEqual(await run(args, os.tmpdir()), r);
  assert.deepEqual(await fs.readFile(config), before);
  const missing = await run(["plan", "--config", path.join(s.root, "missing")]);
  assert.equal(missing.exitCode, 4);
  assert.equal(missing.diagnostics[0].code, "CONFIG_NOT_FOUND");
});

test(
  "Windows lifecycle: empty init, stable IDs, idempotence, missing-source remove, profile preservation",
  { skip: process.platform !== "win32" },
  async (t) => {
    const s = await sandbox(t),
      before = await notes(s.vault);
    assert.equal((await init(s)).effect, "committed");
    assert.equal((await init(s)).diagnostics[0].code, "CONFIG_EXISTS");
    let c = JSON.parse(await fs.readFile(s.config, "utf8"));
    c.site.profile = { name: "  作者  ", bio: "资料", socials: [] };
    c.site.friends = [{ name: "friend", url: "https://example.org" }];
    c.theme.settings.accentColor = "#abcdef";
    await fs.writeFile(s.config, JSON.stringify(c));
    const args = [
      "content",
      "add",
      "文章/起步.md",
      "--slug",
      "first",
      "--config",
      s.config,
    ];
    const first = await run(args);
    assert.equal(first.exitCode, 0);
    const id = first.data.entry.id;
    assert.match(id, /^[a-f0-9-]{36}$/);
    const bytes = await fs.readFile(s.config);
    const again = await run(args);
    assert.equal(again.data.changed, false);
    assert.deepEqual(await fs.readFile(s.config), bytes);
    const after = JSON.parse(bytes);
    assert.deepEqual(after.site, c.site);
    assert.deepEqual(after.theme, c.theme);
    const check = await run(["check", "--config", s.config], os.tmpdir());
    assert.equal(check.exitCode, 3);
    assert.equal(check.data.buildable, false);
    assert.deepEqual(check.data.failedChecks, ["references"]);
    assert.deepEqual(check.data.unperformedChecks, []);
    assert.equal(
      (await run(["content", "remove", id, "--config", s.config])).data.changed,
      true,
    );
    assert.equal((await run(args)).data.entry.id, id);
    assert.deepEqual(await notes(s.vault), before);
    await fs.unlink(path.join(s.vault, "文章/起步.md"));
    assert.equal((await run(["check", "--config", s.config])).exitCode, 3);
    assert.equal(
      (await run(["content", "list", "--config", s.config])).exitCode,
      0,
    );
    assert.equal(
      (await run(["content", "remove", id, "--config", s.config])).exitCode,
      0,
    );
    assert.equal(
      (await run(["content", "remove", id, "--config", s.config])).data.changed,
      false,
    );
  },
);

test(
  "empty and site-only check distinguish false from ready, output overlap is rejected",
  { skip: process.platform !== "win32" },
  async (t) => {
    const s = await sandbox(t);
    assert.equal((await init(s)).exitCode, 0);
    assert.equal(
      (await run(["check", "--config", s.config])).data.buildable,
      false,
    );
    const c = JSON.parse(await fs.readFile(s.config, "utf8"));
    c.site.profile = { name: "a", bio: "b", socials: [] };
    await fs.writeFile(s.config, JSON.stringify(c));
    assert.equal(
      (await run(["check", "--config", s.config])).data.buildable,
      true,
    );
    c.output.directory = s.vault;
    await fs.writeFile(s.config, JSON.stringify(c));
    assert.equal(
      (await run(["check", "--config", s.config])).diagnostics[0].code,
      "PATH_OUT_OF_SCOPE",
    );
  },
);

test(
  "source aliases, reserved routes and unsafe state fail without config modification",
  { skip: process.platform !== "win32" },
  async (t) => {
    const s = await sandbox(t);
    await init(s);
    const bytes = await fs.readFile(s.config);
    const bad = await run([
      "content",
      "add",
      "../private.md",
      "--slug",
      "oops",
      "--config",
      s.config,
    ]);
    assert.equal(bad.exitCode, 2);
    const reserved = await run([
      "content",
      "add",
      "文章/起步.md",
      "--slug",
      "friends",
      "--config",
      s.config,
    ]);
    assert.equal(reserved.diagnostics[0].code, "DUPLICATE_ROUTE");
    assert.deepEqual(await fs.readFile(s.config), bytes);
    await run([
      "content",
      "add",
      "文章/起步.md",
      "--slug",
      "first",
      "--config",
      s.config,
    ]);
    await fs.link(
      path.join(s.vault, "文章/起步.md"),
      path.join(s.vault, "alias.md"),
    );
    assert.equal(
      (
        await run([
          "content",
          "add",
          "alias.md",
          "--slug",
          "alias",
          "--config",
          s.config,
        ])
      ).diagnostics[0].code,
      "ENTRY_CONFLICT",
    );
    await fs.writeFile(
      path.join(path.dirname(s.config), ".corkoro-state", "marker.json"),
      "{}",
    );
    assert.equal(
      (await run(["content", "remove", "missing", "--config", s.config]))
        .diagnostics[0].code,
      "UNSAFE_TRANSACTION_STATE",
    );
  },
);

test(
  "real process lock contention and owner termination release the stable lock",
  { skip: process.platform !== "win32" },
  async (t) => {
    const s = await sandbox(t);
    await init(s);
    const worker = path.join(s.root, "holder.mjs");
    const moduleUrl = new URL(
      "../../dist/packages/publisher/src/index.js",
      import.meta.url,
    ).href;
    await fs.writeFile(
      worker,
      `import {openTransaction} from ${JSON.stringify(moduleUrl)};await openTransaction(process.argv[2]);console.log('ready');setInterval(()=>{},1000);`,
    );
    const child = spawn(process.execPath, [worker, s.config], {
      windowsHide: true,
    });
    s.cleanup.push(async () => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill();
        await once(child, "close");
      }
    });
    await once(child.stdout, "data");
    const blocked = await run([
      "content",
      "remove",
      "missing",
      "--config",
      s.config,
    ]);
    assert.equal(blocked.diagnostics[0].code, "CONFIG_BUSY");
    child.kill();
    await once(child, "close");
    // Parent pipe closure releases the helper's lock asynchronously; retry only in this test client.
    let next;
    for (let i = 0; i < 20; i++) {
      next = await run(["content", "remove", "missing", "--config", s.config]);
      if (next.diagnostics[0].code !== "CONFIG_BUSY") break;
    }
    assert.equal(next.diagnostics[0].code, "UNKNOWN_ID");
  },
);

test(
  "configuration conflict, precommit cancellation and absent-only creation preserve state",
  { skip: process.platform !== "win32" },
  async (t) => {
    const s = await sandbox(t);
    await init(s);
    let tx = await openTransaction(s.config);
    const before = await fs.readFile(s.config);
    await fs.writeFile(s.config, Buffer.concat([before, Buffer.from(" ")]));
    await assert.rejects(
      tx.commit(
        before,
        "sha256:" + createHash("sha256").update(before).digest("hex"),
      ),
      (e) => e.code === "CONFIG_CHANGED",
    );
    const controller = new AbortController();
    tx = await openTransaction(s.config, controller.signal);
    controller.abort();
    await assert.rejects(
      tx.commit(before, null),
      (e) => e.code === "CANCELLED",
    );
    const orphan = path.join(
      path.dirname(s.config),
      ".corkoro-state",
      "orphan.tmp",
    );
    await fs.writeFile(orphan, "keep");
    const r = await run(["content", "remove", "missing", "--config", s.config]);
    assert.equal(
      r.diagnostics.some((d) => d.code === "CLEANUP_PENDING"),
      true,
    );
    assert.equal(await fs.readFile(orphan, "utf8"), "keep");
  },
);

test(
  "simultaneous initializers never overwrite each other",
  { skip: process.platform !== "win32" },
  async (t) => {
    const s = await sandbox(t);
    const tx = await openTransaction(s.config);
    await tx.close();
    const results = await Promise.all([init(s), init(s)]);
    assert.equal(results.filter((r) => r.effect === "committed").length, 1);
    assert.equal(results.filter((r) => r.exitCode === 4).length, 1);
    assert.ok(
      results
        .filter((r) => r.exitCode === 4)
        .every((r) =>
          ["CONFIG_BUSY", "CONFIG_EXISTS"].includes(r.diagnostics[0].code),
        ),
    );
    assert.equal(
      (await run(["content", "list", "--config", s.config])).data.entries
        .length,
      0,
    );
  },
);

test(
  "lost response after a real commit can be retried without changing identity",
  { skip: process.platform !== "win32" },
  async (t) => {
    const s = await sandbox(t);
    await init(s);
    const worker = path.join(s.root, "no-response.mjs");
    const moduleUrl = new URL(
      "../../dist/packages/publisher/src/index.js",
      import.meta.url,
    ).href;
    const request = {
      command: "content add",
      target: "文章/起步.md",
      slug: "first",
      config: s.config,
    };
    await fs.writeFile(
      worker,
      `import {execute} from ${JSON.stringify(moduleUrl)};const r=await execute(${JSON.stringify(request)});process.exit(r.effect==='committed'?9:10);`,
    );
    const child = spawn(process.execPath, [worker], { windowsHide: true });
    const [status] = await once(child, "close");
    assert.equal(status, 9);
    const before = await fs.readFile(s.config);
    const r = await run([
      "content",
      "add",
      "文章/起步.md",
      "--slug",
      "first",
      "--config",
      s.config,
    ]);
    assert.equal(r.data.changed, false);
    assert.deepEqual(await fs.readFile(s.config), before);
  },
);

test(
  "junction escape and config disguised as Markdown are blocked by path checks",
  { skip: process.platform !== "win32" },
  async (t) => {
    const s = await sandbox(t);
    await init(s);
    const external = path.join(s.root, "outside");
    await fs.mkdir(external);
    await fs.writeFile(path.join(external, "secret.md"), "fixture only");
    await fs.symlink(external, path.join(s.vault, "escaped"), "junction");
    assert.equal(
      (
        await run([
          "content",
          "add",
          "escaped/secret.md",
          "--slug",
          "escape",
          "--config",
          s.config,
        ])
      ).diagnostics[0].code,
      "PATH_OUT_OF_SCOPE",
    );
    let c = JSON.parse(await fs.readFile(s.config, "utf8"));
    c.publication.entries = [
      {
        source: "alias.md",
        id: "config-alias",
        slug: "config-alias",
        publish: true,
      },
    ];
    await fs.writeFile(s.config, JSON.stringify(c));
    await fs.link(s.config, path.join(s.vault, "alias.md"));
    assert.equal(
      (await run(["check", "--config", s.config])).diagnostics[0].code,
      "PATH_OUT_OF_SCOPE",
    );
  },
);
