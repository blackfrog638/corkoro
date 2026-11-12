import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { execute } from "../../dist/packages/publisher/src/index.js";

async function fixture(t, name = "selected") {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "corkoro-plan-"));
  t.after(async () => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith("corkoro-plan-"));
    await fs.rm(root, { recursive: true, force: true });
  });
  const vault = path.join(root, "中文 Vault");
  await fs.cp(new URL("../fixtures/vault", import.meta.url), vault, {
    recursive: true,
  });
  const config = path.join(vault, "网站", `${name}.config.json`);
  const value = JSON.parse(await fs.readFile(config, "utf8"));
  value.output.directory = path.join(root, "out");
  const save = () => fs.writeFile(config, JSON.stringify(value));
  await save();
  return {
    root,
    vault,
    config,
    value,
    save,
    plan: () => execute({ command: "plan", config }),
    note: (body) => fs.writeFile(path.join(vault, "文章/起步.md"), body),
  };
}
async function digest(dir) {
  const found = {};
  for (const entry of await fs.readdir(dir, {
    recursive: true,
    withFileTypes: true,
  })) {
    if (entry.isFile()) {
      const p = path.join(entry.parentPath, entry.name);
      found[path.relative(dir, p)] = createHash("sha256")
        .update(await fs.readFile(p))
        .digest("hex");
    }
  }
  return found;
}
test("plan explains only explicit entries and referenced assets, without writes or private text", async (t) => {
  const s = await fixture(t),
    before = await digest(s.root);
  const r = await s.plan();
  assert.equal(r.exitCode, 0);
  assert.equal(r.effect, "none");
  assert.equal(r.data.buildable, true);
  assert.equal(r.data.complete, true);
  assert.deepEqual(
    r.data.articles.map((x) => x.id),
    ["fixture-first", "fixture-related"],
  );
  assert.equal(r.data.pages[0].source, "网站/关于.md");
  assert.equal(r.data.articles[0].reason.code, "SELECTED_ARTICLE");
  assert.deepEqual(
    r.data.assets.map((x) => [x.assetRoot, x.path]),
    [
      [0, "diagram.svg"],
      [1, "avatar.svg"],
    ],
  );
  assert.equal(r.data.assets[0].reasons[0].fromId, "fixture-first");
  assert.equal(r.data.assets[1].reasons[0].field, "/site/profile/avatar");
  assert.equal(r.data.changes, null);
  assert.ok(r.diagnostics.some((d) => d.code === "BASELINE_NOT_SUPPORTED"));
  assert.equal(JSON.stringify(r.data).includes("私人笔记"), false);
  assert.deepEqual(await digest(s.root), before);
  const check = await execute({ command: "check", config: s.config });
  assert.equal(check.data.buildable, true);
  assert.deepEqual(check.data.unperformedChecks, []);
});
test("unselected links and embeds block without expanding authorization", async (t) => {
  const s = await fixture(t, "blocked");
  const r = await s.plan();
  assert.equal(r.exitCode, 3);
  assert.equal(r.data.complete, true);
  assert.equal(r.data.buildable, false);
  assert.deepEqual(
    r.data.blockedReferences.map((x) => x.code),
    ["UNPUBLISHED_TARGET", "UNPUBLISHED_EMBED", "UNPUBLISHED_EMBED"],
  );
  assert.ok(r.data.blockedReferences.every((x) => x.line > 0 && x.column > 0));
  assert.equal(r.data.articles.length, 1);
});
test("empty, page-only, profile-only and friend-only plans follow the same readiness rules", async (t) => {
  const s = await fixture(t, "pages-only");
  assert.equal((await s.plan()).data.buildable, true);
  s.value.site.pages = [];
  s.value.site.profile = null;
  s.value.site.friends = [];
  await s.save();
  const empty = await s.plan();
  assert.equal(empty.exitCode, 0);
  assert.equal(empty.data.buildable, false);
  assert.deepEqual(empty.data.assets, []);
  s.value.site.profile = { name: "作者", bio: "简介", socials: [] };
  await s.save();
  assert.equal((await s.plan()).data.buildable, true);
  s.value.site.profile = null;
  s.value.site.friends = [{ name: "友链", url: "https://example.org" }];
  await s.save();
  assert.equal((await s.plan()).data.buildable, true);
});
test("Markdown references ignore code and metadata and resolve percent-encoded paths and definitions", async (t) => {
  const s = await fixture(t);
  await s.note(
    '---\nprivate: "[[私人笔记]]"\n---\n# 起步\n`[[私人笔记]]`\n\n```md\n![[私人笔记]]\n```\n\n\\[\\[私人笔记]]\n[已选](%E7%9B%B8%E5%85%B3%E9%98%85%E8%AF%BB.md)\n![图][pic]\n\n[pic]: ../attachments/diagram.svg "标题"\n\n[外链](https://example.org/a.md)',
  );
  assert.equal((await s.plan()).data.buildable, true);
  s.value.source.format = "markdown";
  await s.save();
  await s.note("[[私人笔记]]");
  assert.equal((await s.plan()).exitCode, 3);
});
test("ambiguous wiki names, unsupported embeds, fragments and HTML are explicit blockers", async (t) => {
  const s = await fixture(t);
  await fs.mkdir(path.join(s.vault, "重复"));
  await fs.writeFile(
    path.join(s.vault, "重复/相关阅读.md"),
    "private duplicate",
  );
  await fs.writeFile(
    path.join(s.vault, "相关阅读.md"),
    "private duplicate root",
  );
  await s.note(
    "[[相关阅读]]\n![[文章/相关阅读]]\n[标题](相关阅读.md#heading)\n<img src='../私人笔记.md'>",
  );
  const r = await s.plan();
  assert.equal(r.exitCode, 3);
  assert.ok(
    r.data.blockedReferences.some((x) => x.code === "UNSUPPORTED_SYNTAX"),
  );
  assert.ok(
    r.data.blockedReferences.some((x) => x.code === "AMBIGUOUS_TARGET"),
  );
  await s.note("[[文章/相关阅读|显示别名]]");
  assert.equal((await s.plan()).data.buildable, true);
  await fs.writeFile(path.join(s.vault, "重复/同名.md"), "private 1");
  await fs.writeFile(path.join(s.vault, "同名.md"), "private 2");
  await s.note("[[同名]]");
  const r2 = await s.plan();
  assert.equal(r2.data.buildable, false);
  assert.equal(r2.data.blockedReferences[0].code, "AMBIGUOUS_TARGET");
});
test("shared assets retain every authorizing entry and unsupported references never read private bodies", async (t) => {
  const s = await fixture(t);
  await fs.writeFile(
    path.join(s.vault, "文章/相关阅读.md"),
    "![[attachments/diagram.svg]]\n[[文章/起步|别名]]",
  );
  await fs.writeFile(path.join(s.vault, "私人笔记.md"), Buffer.from([0xff]));
  let r = await s.plan();
  assert.equal(r.data.buildable, true);
  assert.deepEqual(
    r.data.assets[0].reasons.map((x) => x.fromId),
    ["fixture-first", "fixture-related"],
  );
  await s.note(
    "[[私人笔记]]\n![[文章/相关阅读]]\n[x](javascript:alert)\n[x](file:///private.md)",
  );
  r = await s.plan();
  assert.equal(r.data.complete, true);
  assert.deepEqual(
    r.data.blockedReferences.map((x) => x.code),
    [
      "UNPUBLISHED_TARGET",
      "UNSUPPORTED_SYNTAX",
      "PATH_OUT_OF_SCOPE",
      "PATH_OUT_OF_SCOPE",
    ],
  );
});
test(
  "asset-root escapes through a junction are blocked",
  { skip: process.platform !== "win32" },
  async (t) => {
    const s = await fixture(t);
    const outside = path.join(s.root, "private-assets");
    await fs.mkdir(outside);
    await fs.copyFile(
      path.join(s.vault, "attachments/diagram.svg"),
      path.join(outside, "private.svg"),
    );
    await fs.symlink(
      outside,
      path.join(s.vault, "attachments/escape"),
      "junction",
    );
    await s.note("![image](../attachments/escape/private.svg)");
    const r = await s.plan();
    assert.equal(r.data.blockedReferences[0].code, "PATH_OUT_OF_SCOPE");
    assert.equal(
      r.data.assets.some((x) => x.path.includes("private")),
      false,
    );
  },
);
test("asset validation rejects disguised notes, active SVG, config aliases and out-of-scope files", async (t) => {
  const s = await fixture(t);
  const attacks = [
    ["fake.png", "# private note"],
    [
      "active.svg",
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    ],
    [
      "remote.svg",
      '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://example.org/x"/></svg>',
    ],
  ];
  for (const [name, body] of attacks) {
    await fs.writeFile(path.join(s.vault, "attachments", name), body);
    await s.note(`![image](../attachments/${name})`);
    const r = await s.plan();
    assert.equal(r.exitCode, 3, name);
    assert.equal(
      r.data.assets.some((x) => x.path === name),
      false,
    );
    assert.ok(r.diagnostics.some((x) => x.code === "UNSUPPORTED_ASSET"));
  }
  await fs.link(s.config, path.join(s.vault, "attachments/config.svg"));
  await s.note("![config](../attachments/config.svg)");
  assert.ok(
    (await s.plan()).diagnostics.some((x) => x.code === "PATH_OUT_OF_SCOPE"),
  );
  await s.note("![outside](../../secret.svg)");
  assert.ok(
    (await s.plan()).diagnostics.some((x) => x.code === "PATH_OUT_OF_SCOPE"),
  );
});
test("missing references finish with errors; missing entry stops before reference analysis", async (t) => {
  const s = await fixture(t);
  await s.note("[missing](missing.md)");
  let r = await s.plan();
  assert.equal(r.data.complete, true);
  assert.equal(r.data.blockedReferences[0].code, "MISSING_TARGET");
  await fs.unlink(path.join(s.vault, "文章/起步.md"));
  r = await s.plan();
  assert.equal(r.exitCode, 3);
  assert.equal(r.data.complete, false);
  const check = await execute({ command: "check", config: s.config });
  assert.deepEqual(check.data.failedChecks, ["paths"]);
  assert.deepEqual(check.data.unperformedChecks, ["references"]);
});

test("diagnostics follow protocol source order independently of selection order", async (t) => {
  const s = await fixture(t);
  await s.note("[missing](missing.md)");
  await fs.writeFile(
    path.join(s.vault, "文章/相关阅读.md"),
    "[missing](missing.md)",
  );
  const first = await s.plan();
  s.value.publication.entries.reverse();
  await s.save();
  const second = await s.plan();
  assert.deepEqual(second.diagnostics, first.diagnostics);
});

test(
  "pages resolve against canonical source roots even when configuration uses a junction alias",
  { skip: process.platform !== "win32" },
  async (t) => {
    const s = await fixture(t, "pages-only");
    const alias = path.join(s.root, "source-alias");
    await fs.symlink(s.vault, alias, "junction");
    s.value.source.root = alias;
    s.value.site.pages[0].source = path.join(s.vault, "网站/关于.md");
    await s.save();
    const r = await s.plan();
    assert.equal(r.exitCode, 0);
    assert.equal(r.data.buildable, true);
    assert.equal(r.data.pages[0].source, "网站/关于.md");
  },
);
