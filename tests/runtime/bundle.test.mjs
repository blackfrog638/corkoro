import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { once } from "node:events";
import * as publisher from "../../dist/packages/publisher/src/index.js";
import {
  bundleSchema,
  digestJson,
  sealBundle,
} from "../../dist/packages/content-contract/src/bundle.js";

test("bundle contract rejects forged references, executable nodes and equivalent routes even with fresh digests", () => {
  const body = {
    type: "root",
    children: [
      { type: "paragraph", children: [{ type: "text", value: "Public" }] },
    ],
  };
  const payload = {
    format: "corkoro-content",
    schemaVersion: 1,
    manifest: {
      site: { title: "Example", profile: null, friends: [] },
      theme: {
        name: "default",
        settings: { colorMode: "system", accentColor: "#336699" },
      },
      documents: [
        {
          id: "one",
          kind: "article",
          route: "/one/",
          title: "One",
          contentHash: digestJson(body),
        },
      ],
      assets: [],
    },
    documents: [{ id: "one", body }],
    assets: [],
  };
  assert.equal(sealBundle(payload).schemaVersion, 1);
  for (const node of [
    { type: "html", value: "<script>alert(1)</script>" },
    {
      type: "image",
      target: { kind: "external", url: " mailto:person@example.org" },
      title: null,
      alt: "invalid",
    },
    {
      type: "link",
      target: { kind: "document", id: "private" },
      title: null,
      children: [],
    },
    {
      type: "link",
      target: { kind: "external", url: "javascript:alert(1)" },
      title: null,
      children: [],
    },
  ]) {
    const p = structuredClone(payload);
    p.documents[0].body.children = [node];
    p.manifest.documents[0].contentHash = digestJson(p.documents[0].body);
    assert.throws(() => sealBundle(p));
  }
  const p = structuredClone(payload);
  p.documents.push({ id: "two", body });
  p.manifest.documents[0].route = `/${encodeURIComponent("é")}/`;
  p.manifest.documents.push({
    ...p.manifest.documents[0],
    id: "two",
    route: `/${encodeURIComponent("e\u0301")}/`,
  });
  assert.throws(() => sealBundle(p), /Duplicate document route/);
  p.manifest.documents[0].route = "/%ZZ/";
  assert.equal(
    bundleSchema.safeParse({ ...p, buildId: digestJson(p) }).success,
    false,
  );
});

async function setup(t, name = "selected") {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "corkoro-bundle-"));
  t.after(async () => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith("corkoro-bundle-"));
    await fs.rm(root, { recursive: true, force: true });
  });
  const vault = path.join(root, "中文 Vault");
  await fs.cp(new URL("../fixtures/vault", import.meta.url), vault, {
    recursive: true,
  });
  const config = path.join(vault, "网站", name + ".config.json");
  const c = JSON.parse(await fs.readFile(config, "utf8"));
  const out = path.join(root, "output");
  c.output.directory = out;
  const save = () => fs.writeFile(config, JSON.stringify(c));
  await save();
  const file = path.join(out, "content.bundle.json");
  return {
    root,
    vault,
    config,
    c,
    save,
    out,
    file,
    build: (signal) => publisher.buildContentBundle(config, signal),
    read: () => publisher.readContentBundle(file),
  };
}
function nodes(node) {
  return [node, ...(node.children ?? []).flatMap(nodes)];
}
async function inputs(dir) {
  const values = {};
  for (const e of await fs.readdir(dir, {
    recursive: true,
    withFileTypes: true,
  }))
    if (e.isFile()) {
      const p = path.join(e.parentPath, e.name);
      values[path.relative(dir, p)] = (await fs.readFile(p)).toString("base64");
    }
  return values;
}

test(
  "bundle contains only public normalized content and rebuilds identically",
  async (t) => {
    const s = await setup(t),
      before = await inputs(s.vault);
    assert.equal(typeof publisher.buildContentBundle, "function");
    s.c.site.address = { origin: "https://example.org", base: "/blog/" };
    await s.save();
    before[path.relative(s.vault, s.config)] = (
      await fs.readFile(s.config)
    ).toString("base64");
    const result = await s.build();
    assert.equal(result.effect, "committed");
    assert.equal(result.exitCode, 0);
    const b = await s.read(),
      bytes = await fs.readFile(s.file);
    assert.equal(b.format, "corkoro-content");
    assert.deepEqual(b.manifest.site.address, s.c.site.address);
    assert.deepEqual(
      b.manifest.documents.map((d) => [d.id, d.kind]),
      [
        ["fixture-first", "article"],
        ["fixture-related", "article"],
        ["page-about", "page"],
      ],
    );
    assert.equal(b.manifest.documents[0].title, "起步");
    assert.equal(b.manifest.assets.length, 2);
    const links = nodes(b.documents[0].body).filter((n) => n.type === "link");
    assert.deepEqual(links[0].target, {
      kind: "document",
      id: "fixture-related",
    });
    for (const secret of [
      s.root,
      "私人笔记",
      "selected.config.json",
      "assetRoots",
      "publication",
      "unreferenced.txt",
    ])
      assert.equal(bytes.toString().includes(secret), false, secret);
    assert.deepEqual(await inputs(s.vault), before);
    const repeat = await s.build();
    assert.equal(repeat.effect, "none");
    assert.equal(repeat.buildId, result.buildId);
    assert.deepEqual(await fs.readFile(s.file), bytes);
    assert.equal(path.dirname(s.out), s.root);
    await fs.rm(s.out, { recursive: true, force: true });
    assert.equal((await s.build()).effect, "committed");
    assert.deepEqual(await fs.readFile(s.file), bytes);
  },
);

test(
  "zero-article bundles support pages, profile or friends independently",
  async (t) => {
    const s = await setup(t);
    s.c.publication.entries.forEach((e) => (e.publish = false));
    const profile = s.c.site.profile,
      friends = s.c.site.friends;
    s.c.site.profile = null;
    s.c.site.friends = [];
    await s.save();
    assert.equal((await s.build()).exitCode, 0);
    assert.deepEqual(
      (await s.read()).manifest.documents.map((d) => d.kind),
      ["page"],
    );
    s.c.site.pages.forEach((p) => (p.publish = false));
    s.c.site.profile = profile;
    await s.save();
    assert.equal((await s.build()).exitCode, 0);
    assert.equal((await s.read()).documents.length, 0);
    assert.equal((await s.read()).assets.length, 1);
    s.c.site.profile = null;
    s.c.site.friends = friends;
    await s.save();
    assert.equal((await s.build()).exitCode, 0);
    assert.equal((await s.read()).assets.length, 0);
    assert.deepEqual((await s.read()).manifest.site.friends, friends);
  },
);

test(
  "conversion preserves CommonMark and wiki labels while stripping source metadata",
  async (t) => {
    const s = await setup(t);
    await fs.writeFile(
      path.join(s.vault, "文章/起步.md"),
      '---\nsecret: frontmatter-private-marker\n---\n# 标题\n\n**[[相关阅读|a_b]]** 与 [普通 *强调*](相关阅读.md "说明")\n\n![图][image]\n\n[image]: ../attachments/diagram.svg "图标题"\n\n- item\n\n> quote\n\n```js\nconst x = "<script>";\n```\n',
    );
    assert.equal((await s.build()).exitCode, 0);
    const b = await s.read(),
      all = nodes(b.documents[0].body);
    assert.ok(all.some((n) => n.type === "strong"));
    assert.ok(all.some((n) => n.type === "text" && n.value === "a_b"));
    assert.ok(all.some((n) => n.type === "image" && n.title === "图标题"));
    assert.ok(
      all.some((n) => n.type === "code" && n.value.includes("<script>")),
    );
    assert.equal(
      JSON.stringify(b).includes("frontmatter-private-marker"),
      false,
    );
    assert.equal(
      all.some(
        (n) => "position" in n || n.type === "definition" || n.type === "yaml",
      ),
      false,
    );
  },
);

test(
  "withdrawal replaces the bundle without old documents or unreferenced assets",
  async (t) => {
    const s = await setup(t);
    await s.build();
    await fs.writeFile(path.join(s.out, "user-file.txt"), "keep");
    s.c.publication.entries.forEach((e) => (e.publish = false));
    await s.save();
    const r = await s.build(),
      b = await s.read();
    assert.equal(r.effect, "committed");
    assert.deepEqual(
      b.manifest.documents.map((d) => d.id),
      ["page-about"],
    );
    assert.equal(b.assets.length, 1);
    assert.equal(
      await fs.readFile(path.join(s.out, "user-file.txt"), "utf8"),
      "keep",
    );
  },
);

test(
  "blocked or empty input cannot damage the previous bundle; renamed sources retain identity",
  async (t) => {
    const s = await setup(t);
    await s.build();
    const before = await fs.readFile(s.file);
    await fs.rename(
      path.join(s.vault, "文章/起步.md"),
      path.join(s.vault, "文章/改名.md"),
    );
    s.c.publication.entries[0].source = "文章/改名.md";
    await s.save();
    assert.equal((await s.build()).effect, "none");
    await fs.writeFile(path.join(s.vault, "文章/改名.md"), "![[私人笔记]]");
    let r = await s.build();
    assert.equal(r.exitCode, 3);
    assert.equal(r.effect, "none");
    assert.deepEqual(await fs.readFile(s.file), before);
    s.c.publication.entries = [];
    s.c.site.pages = [];
    s.c.site.profile = null;
    s.c.site.friends = [];
    await s.save();
    r = await s.build();
    assert.equal(r.diagnostics[0].code, "EMPTY_SELECTION");
    assert.deepEqual(await fs.readFile(s.file), before);
  },
);

test(
  "unowned targets and hardlinks are not overwritten; output overlap is refused",
  async (t) => {
    const s = await setup(t);
    await fs.mkdir(s.out);
    await fs.writeFile(s.file, "user data");
    assert.equal((await s.build()).diagnostics[0].code, "OUTPUT_NOT_OWNED");
    assert.equal(await fs.readFile(s.file, "utf8"), "user data");
    await fs.unlink(s.file);
    await fs.link(s.config, s.file);
    assert.equal((await s.build()).effect, "none");
    assert.deepEqual(await fs.readFile(s.config), await fs.readFile(s.file));
    s.c.output.directory = s.vault;
    await s.save();
    assert.equal((await s.build()).diagnostics[0].code, "PATH_OUT_OF_SCOPE");
  },
);

test(
  "conversion uses captured bytes even when an already-read source changes",
  async (t) => {
    const s = await setup(t),
      open = fs.open;
    const first = path.join(s.vault, "文章/起步.md"),
      second = await fs.realpath(path.join(s.vault, "文章/相关阅读.md"));
    let changed = false;
    fs.open = async (...args) => {
      if (!changed && path.resolve(String(args[0])) === second) {
        changed = true;
        await fs.writeFile(first, "![[私人笔记]]");
      }
      return open(...args);
    };
    let result;
    try {
      result = await s.build();
    } finally {
      fs.open = open;
    }
    assert.equal(changed, true);
    assert.equal(result.exitCode, 0);
    assert.equal((await s.read()).manifest.documents[0].title, "起步");
    assert.equal((await s.build()).exitCode, 3);
  },
);

test(
  "output writers serialize and a lost response can be reconciled",
  async (t) => {
    const s = await setup(t);
    await s.build();
    const tx = await publisher.openTransaction(s.file);
    try {
      assert.equal((await s.build()).diagnostics[0].code, "OUTPUT_BUSY");
    } finally {
      await tx.close();
    }
    const worker = path.join(s.root, "build.mjs");
    const moduleUrl = new URL(
      "../../dist/packages/publisher/src/index.js",
      import.meta.url,
    ).href;
    await fs.writeFile(
      worker,
      `import {buildContentBundle} from ${JSON.stringify(moduleUrl)};const r=await buildContentBundle(process.argv[2]);process.exit(r.exitCode);`,
    );
    s.c.site.title = "新标题";
    await s.save();
    const child = spawn(process.execPath, [worker, s.config], {
      windowsHide: true,
      cwd: os.tmpdir(),
    });
    const [exit] = await once(child, "close");
    assert.equal(exit, 0);
    assert.equal((await s.read()).manifest.site.title, "新标题");
    assert.equal((await s.build()).effect, "none");
  },
);

test(
  "bundle reader rejects tampering and unsupported versions",
  async (t) => {
    const s = await setup(t);
    await s.build();
    const b = JSON.parse(await fs.readFile(s.file, "utf8"));
    b.documents[0].body.children = [];
    await fs.writeFile(s.file, JSON.stringify(b));
    await assert.rejects(s.read(), (e) => e.code === "INVALID_BUNDLE");
    assert.equal((await s.build()).diagnostics[0].code, "OUTPUT_NOT_OWNED");
    b.schemaVersion = 999;
    await fs.writeFile(s.file, JSON.stringify(b));
    await assert.rejects(s.read(), (e) => e.code === "INVALID_BUNDLE");
  },
);

test(
  "process interruption after staging leaves the old bundle and never replays the orphan",
  async (t) => {
    const s = await setup(t);
    await s.build();
    const before = await fs.readFile(s.file);
    s.c.site.title = "未提交的候选";
    await s.save();
    const worker = path.join(s.root, "interrupt.mjs");
    const moduleUrl = new URL(
      "../../dist/packages/publisher/src/index.js",
      import.meta.url,
    ).href;
    await fs.writeFile(
      worker,
      `import fs from 'node:fs/promises';import {buildContentBundle} from ${JSON.stringify(moduleUrl)};const open=fs.open;fs.open=async (...args)=>{const h=await open(...args);if(String(args[0]).endsWith('.tmp')){const sync=h.sync.bind(h);h.sync=async()=>{await sync();process.exit(17);};}return h;};await buildContentBundle(process.argv[2]);`,
    );
    const child = spawn(process.execPath, [worker, s.config], {
      windowsHide: true,
    });
    const [exit] = await once(child, "close");
    assert.equal(exit, 17);
    assert.deepEqual(await fs.readFile(s.file), before);
    const state = path.join(s.out, ".corkoro-state");
    const orphans = (await fs.readdir(state)).filter((x) => x.endsWith(".tmp"));
    assert.equal(orphans.length, 1);
    s.c.site.title = JSON.parse(before).manifest.site.title;
    await s.save();
    let next;
    for (let i = 0; i < 20; i++) {
      next = await s.build();
      if (!next.diagnostics.some((d) => d.code === "OUTPUT_BUSY")) break;
    }
    assert.equal(next.effect, "none");
    assert.equal(next.exitCode, 0);
    assert.ok(next.diagnostics.some((d) => d.code === "CLEANUP_PENDING"));
    assert.deepEqual(
      (await fs.readdir(state)).filter((x) => x.endsWith(".tmp")),
      orphans,
    );
    assert.deepEqual(await fs.readFile(s.file), before);
  },
);

test(
  "precommit cancellation preserves the bundle and does not claim a commit",
  async (t) => {
    const s = await setup(t);
    await s.build();
    const before = await fs.readFile(s.file);
    const controller = new AbortController(),
      open = fs.open;
    s.c.site.title = "取消";
    await s.save();
    fs.open = async (...args) => {
      const h = await open(...args);
      if (String(args[0]).endsWith(".tmp")) {
        const sync = h.sync.bind(h);
        h.sync = async () => {
          await sync();
          controller.abort();
        };
      }
      return h;
    };
    let r;
    try {
      r = await s.build(controller.signal);
    } finally {
      fs.open = open;
    }
    assert.equal(r.exitCode, 130);
    assert.equal(r.effect, "none");
    assert.deepEqual(await fs.readFile(s.file), before);
  },
);

test(
  "the Windows carrier prevents replacing a transaction parent while locked",
  { skip: process.platform !== "win32" },
  async (t) => {
    const s = await setup(t);
    await s.build();
    const tx = await publisher.openTransaction(s.file);
    const moved = path.join(s.root, "original-output");
    try {
      await assert.rejects(fs.rename(s.out, moved), (e) =>
        ["EPERM", "EACCES", "EBUSY"].includes(e.code),
      );
      assert.equal(
        (await publisher.readContentBundle(s.file)).format,
        "corkoro-content",
      );
    } finally {
      await tx.close();
    }
  },
);

test(
  "replacing an output junction after capture cannot redirect writes into the Vault",
  async (t) => {
    const s = await setup(t);
    await fs.mkdir(s.out);
    const alias = path.join(s.root, "output-alias");
    await fs.symlink(s.out, alias, "junction");
    s.c.output.directory = alias;
    await s.save();
    const before = await inputs(s.vault),
      open = fs.open;
    const firstSource = await fs.realpath(path.join(s.vault, "文章/起步.md"));
    let replaced = false;
    fs.open = async (...args) => {
      if (!replaced && path.resolve(String(args[0])) === firstSource) {
        replaced = true;
        await fs.unlink(alias);
        await fs.symlink(s.vault, alias, "junction");
      }
      return open(...args);
    };
    let r;
    try {
      r = await s.build();
    } finally {
      fs.open = open;
    }
    assert.equal(replaced, true);
    assert.equal(r.exitCode, 0);
    assert.equal((await s.read()).format, "corkoro-content");
    assert.deepEqual(await inputs(s.vault), before);
  },
);
