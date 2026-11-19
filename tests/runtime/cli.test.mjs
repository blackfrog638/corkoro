import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFileSync, spawn } from "node:child_process";
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
  child.stdout.setEncoding("utf8").on("data", (s) => (stdout += s));
  child.stderr.setEncoding("utf8").on("data", (s) => (stderr += s));
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

test("POSIX transaction slots follow native case and Unicode lookup", {
  skip: !["darwin", "linux"].includes(process.platform),
}, async (t) => {
  const s = await sandbox(t);
  const name = "Café.json";
  const target = path.join(s.root, name);
  await fs.writeFile(target, "{}");
  const aliases = ["café.json", name.normalize("NFD")];
  const same = await Promise.all(aliases.map(async (alias) => {
    try {
      return (await fs.stat(path.join(s.root, alias))).ino === (await fs.stat(target)).ino;
    } catch (error) {
      if (error.code === "ENOENT") return false;
      throw error;
    }
  }));
  await fs.unlink(target); // Concurrent init must work before a target inode exists.
  const tx = await openTransaction(target);
  try {
    for (const [index, alias] of aliases.entries()) {
      const other = openTransaction(path.join(s.root, alias));
      if (same[index]) await assert.rejects(other, { code: "CONFIG_BUSY" });
      else await (await other).close();
    }
    await tx.commit(Buffer.from("{}"), null);
    assert.equal((await fs.stat(target)).mode & 0o077, 0);
  } finally {
    await tx.close();
  }
});

test("POSIX detects replacement of the locked parent before commit", {
  skip: !["darwin", "linux"].includes(process.platform),
}, async (t) => {
  const s = await sandbox(t);
  const tx = await openTransaction(s.config);
  const dir = path.dirname(s.config);
  try {
    await fs.rename(dir, dir + "-moved");
    await fs.mkdir(dir);
    await assert.rejects(tx.commit(Buffer.from("{}"), null), {
      code: "UNSAFE_TRANSACTION_STATE",
    });
    await assert.rejects(fs.stat(s.config), { code: "ENOENT" });
  } finally {
    await tx.close();
  }
});

test("an unsupported Linux tmpfs is rejected before creating transaction metadata", {
  skip: process.platform !== "linux",
}, async (t) => {
  const dir = await fs.mkdtemp("/dev/shm/corkoro-fstype-");
  t.after(() => fs.rmdir(dir));
  await assert.rejects(openTransaction(path.join(dir, "config.json")), {
    code: "TRANSACTION_UNSUPPORTED",
  });
  assert.deepEqual(await fs.readdir(dir), []);
});

test("output isolation follows native directory aliases on APFS", {
  skip: process.platform !== "darwin",
}, async (t) => {
  const s = await sandbox(t);
  const alias = path.join(s.root, "中文 VAULT");
  const config = path.join(s.vault, "网站/selected.config.json");
  const value = JSON.parse(await fs.readFile(config, "utf8"));
  value.output.directory = path.join(alias, "output");
  await fs.writeFile(config, JSON.stringify(value));
  const aliasesVault = await fs.stat(alias).then(() => true, (error) => {
    if (error.code === "ENOENT") return false;
    throw error;
  });
  const result = await run(["check", "--config", config]);
  assert.equal(result.exitCode, aliasesVault ? 3 : 0);
  if (aliasesVault)
    assert.ok(result.diagnostics.some((entry) => entry.code === "PATH_OUT_OF_SCOPE"));
});

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
    [
      "status",
      "--repo",
      "owner/..",
      "--branch",
      "gh-pages",
      "--expected",
      "a".repeat(40),
    ],
    [
      "status",
      "--repo",
      "owner/blog",
      "--branch",
      "gh-pages",
      "--expected",
      "abc",
    ],
  ]) {
    const r = await run(args);
    assert.equal(r.exitCode, 2);
    assert.equal(r.effect, "none");
  }
  const r = await run(["comments", "--config", "missing"]);
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

test("read-only CLI preserves the Vault and selection across working directories", async (t) => {
  const s = await sandbox(t);
  const config = (name) => path.join(s.vault, "网站", name + ".config.json");
  for (const name of ["selected", "blocked", "corkoro"]) {
    const value = JSON.parse(await fs.readFile(config(name), "utf8"));
    value.output.directory = "../../output";
    await fs.writeFile(config(name), JSON.stringify(value));
  }
  async function inventory() {
    const entries = {};
    for (const name of await fs.readdir(s.vault, { recursive: true })) {
      const file = path.join(s.vault, name);
      const stat = await fs.lstat(file);
      entries[name] = stat.isDirectory()
        ? "directory"
        : createHash("sha256")
            .update(await fs.readFile(file))
            .digest("hex");
    }
    return entries;
  }
  const before = await inventory();
  async function read(args, exitCode = 0) {
    const result = await run(args, s.root);
    assert.deepEqual(await run(args, os.tmpdir()), result);
    assert.equal(result.exitCode, exitCode);
    assert.equal(result.effect, "none");
    return result;
  }
  const selected = ["--config", config("selected")];
  const scan = await read([
    "inspect",
    "--source",
    s.vault,
    "--format",
    "obsidian-markdown",
  ]);
  assert.ok(
    scan.data.inventory.some(
      (x) => x.source === "文章/标记候选.md" && x.publishHint,
    ),
  );
  const list = await read(["content", "list", ...selected]);
  const ids = ["fixture-first", "fixture-related"];
  assert.deepEqual(
    list.data.entries.map((entry) => entry.id),
    ids,
  );
  const check = await read(["check", ...selected]);
  assert.equal(check.data.complete, true);
  assert.equal(check.data.buildable, true);
  const plan = await read(["plan", ...selected]);
  assert.deepEqual(
    plan.data.articles.map((entry) => entry.id),
    ids,
  );
  assert.deepEqual(
    plan.data.pages.map((p) => [p.id, p.route]),
    [["page-about", "/about/"]],
  );
  assert.deepEqual(
    plan.data.assets.map((a) => a.path),
    ["diagram.svg", "avatar.svg"],
  );
  assert.equal(plan.data.assets[0].reasons[0].fromId, "fixture-first");
  assert.equal(plan.data.assets[1].reasons[0].field, "/site/profile/avatar");
  const empty = await read(["plan", "--config", config("corkoro")]);
  assert.equal(empty.data.buildable, false);
  const blocked = await read(["plan", "--config", config("blocked")], 3);
  assert.equal(blocked.data.buildable, false);
  assert.deepEqual(
    blocked.data.blockedReferences.map((r) => r.code),
    ["UNPUBLISHED_TARGET", "UNPUBLISHED_EMBED", "UNPUBLISHED_EMBED"],
  );
  const missing = await run(["plan", "--config", path.join(s.root, "missing")]);
  assert.equal(missing.exitCode, 4);
  assert.equal(missing.diagnostics[0].code, "CONFIG_NOT_FOUND");
  assert.deepEqual(await inventory(), before);
  await assert.rejects(fs.stat(s.output), { code: "ENOENT" });
});

test(
  "unsupported platforms reject config initialization before writing",
  {
    skip: ["win32", "linux", "darwin"].includes(process.platform),
  },
  async (t) => {
    const s = await sandbox(t);
    const result = await init(s);
    assert.equal(result.exitCode, 4);
    assert.equal(result.effect, "none");
    assert.equal(result.diagnostics[0].code, "TRANSACTION_UNSUPPORTED");
    await assert.rejects(fs.stat(s.config), { code: "ENOENT" });
    await assert.rejects(
      fs.stat(path.join(path.dirname(s.config), ".corkoro-state")),
      { code: "ENOENT" },
    );
  },
);

test(
  "Configuration lifecycle: empty init, stable IDs, idempotence, missing-source remove, profile preservation",
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
  async (t) => {
    const s = await sandbox(t);
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

test("init refuses a pre-existing unmarked state directory", async (t) => {
  const s = await sandbox(t);
  const state = path.join(path.dirname(s.config), ".corkoro-state");
  await fs.mkdir(state);
  const result = await init(s);
  assert.equal(result.effect, "none");
  assert.equal(result.diagnostics[0].code, "UNSAFE_TRANSACTION_STATE");
  assert.deepEqual(await fs.readdir(state), []);
});

test("another initializer can commit while the first prepares its marker", async (t) => {
  const s = await sandbox(t);
  const staged = Promise.withResolvers();
  const resume = Promise.withResolvers();
  const open = fs.open;
  fs.open = async (file, ...args) => {
    if (path.basename(file) === "marker.json" && args[0] === "wx") {
      staged.resolve();
      await resume.promise;
    }
    return open(file, ...args);
  };
  const preparing = openTransaction(s.config);
  try {
    await Promise.race([
      staged.promise,
      preparing.then(() => assert.fail("marker was not staged")),
    ]);
    const result = await init(s);
    assert.equal(result.effect, "committed");
  } finally {
    fs.open = open;
    resume.resolve();
    await (await preparing).close();
  }
  const names = await fs.readdir(path.dirname(s.config));
  assert.ok(!names.some((name) => name.startsWith(".corkoro-init-")));
});

test(
  "POSIX updates preserve shared access and private configs stay private",
  {
    skip: !["linux", "darwin"].includes(process.platform),
  },
  async (t) => {
    const s = await sandbox(t);
    assert.equal((await init(s)).exitCode, 0);
    assert.equal((await fs.stat(s.config)).mode & 0o777, 0o600);
    await fs.chmod(s.config, 0o640);
    const aclKey = "system.posix_acl_access";
    if (process.platform === "linux") {
      // Grant a named uid read access. chmod alone cannot recreate this entry.
      execFileSync("/usr/bin/python3", [
        "-I",
        "-c",
        "import os,struct,sys; entries=[(1,6,-1),(2,4,12345),(4,0,-1),(16,4,-1),(32,0,-1)]; os.setxattr(sys.argv[1],sys.argv[2],struct.pack('<I',2)+b''.join(struct.pack('<HHi',*e) for e in entries))",
        s.config,
        aclKey,
      ]);
    } else {
      execFileSync("/bin/chmod", ["+a", "everyone allow readattr", s.config]);
    }
    const readAcl = () =>
      process.platform === "linux"
        ? execFileSync(
            "/usr/bin/python3",
            [
              "-I",
              "-c",
              "import os,sys; print(os.getxattr(sys.argv[1],sys.argv[2]).hex())",
              s.config,
              aclKey,
            ],
            { encoding: "utf8" },
          )
        : execFileSync("/bin/ls", ["-lde", s.config], { encoding: "utf8" })
            .split("\n")
            .slice(1)
            .join("\n");
    const acl = readAcl();
    assert.ok(acl.trim());
    const before = await fs.stat(s.config);
    const result = await run([
      "content",
      "add",
      "文章/起步.md",
      "--slug",
      "first",
      "--config",
      s.config,
    ]);
    assert.equal(result.effect, "committed");
    const after = await fs.stat(s.config);
    assert.equal(readAcl(), acl);
    assert.deepEqual(
      [after.mode, after.uid, after.gid],
      [before.mode, before.uid, before.gid],
    );
  },
);

test(
  "missing findmnt reports an unsupported environment before metadata creation",
  {
    skip: process.platform !== "linux",
  },
  async (t) => {
    const s = await sandbox(t);
    const helper = path.join(
      repo,
      "dist/packages/publisher/native/posix-transaction.py",
    );
    const output = execFileSync(
      "/usr/bin/python3",
      [
        "-I",
        "-c",
        "import runpy, sys; from unittest.mock import patch\nwith patch('subprocess.check_output', side_effect=FileNotFoundError('findmnt')):\n runpy.run_path(sys.argv[1], run_name='__main__')",
        helper,
      ],
      { input: JSON.stringify({ path: s.config }) + "\n", encoding: "utf8" },
    );
    assert.deepEqual(JSON.parse(output), { code: "TRANSACTION_UNSUPPORTED" });
    await assert.rejects(
      fs.stat(path.join(path.dirname(s.config), ".corkoro-state")),
      { code: "ENOENT" },
    );
  },
);

test("lost response after a real commit can be retried without changing identity", async (t) => {
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
});

test(
  "junction escape and config disguised as Markdown are blocked by path checks",
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
