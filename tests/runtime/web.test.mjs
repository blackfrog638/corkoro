import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  buildContentBundle,
  openTransaction,
} from "../../dist/packages/publisher/src/index.js";
import { contentRenderer } from "../../dist/apps/web/src/render.js";
import {
  sealBundle,
  digestJson,
} from "../../dist/packages/content-contract/src/bundle.js";

test("public content rendering escapes data and applies base to local targets only", () => {
  const body = { type: "root", children: [] };
  const bundle = sealBundle({
    format: "corkoro-content",
    schemaVersion: 1,
    manifest: {
      site: {
        title: "Test",
        profile: null,
        friends: [],
        address: { origin: "https://example.org", base: "/blog/" },
      },
      theme: {
        name: "default",
        settings: { colorMode: "system", accentColor: "#112233" },
      },
      documents: [
        {
          id: "a",
          kind: "article",
          title: "A",
          route: "/a/",
          contentHash: digestJson(body),
        },
      ],
      assets: [],
    },
    documents: [{ id: "a", body }],
    assets: [],
  });
  const { render } = contentRenderer(bundle);
  assert.equal(
    render({ type: "text", value: '<script>"&' }),
    "&lt;script&gt;&quot;&amp;",
  );
  assert.equal(
    render({
      type: "code",
      value: "</code><script>x</script>",
      lang: '" onclick="x',
    }),
    '<pre><code class="language-&quot; onclick=&quot;x">&lt;/code&gt;&lt;script&gt;x&lt;/script&gt;</code></pre>',
  );
  assert.match(
    render({
      type: "link",
      target: { kind: "document", id: "a" },
      title: null,
      children: [],
    }),
    /href="\/blog\/a\/"/,
  );
  assert.match(
    render({
      type: "link",
      target: { kind: "external", url: 'https://example.net/?q="' },
      title: null,
      children: [],
    }),
    /href="https:\/\/example.net\/\?q=&quot;"/,
  );
});

test(
  "Astro builds an isolated public site, resolves base links and keeps the last site on failure",
  { skip: process.platform !== "win32" },
  async (t) => {
    const web = await import("../../dist/apps/web/src/index.js");
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "corkoro-web-"));
    t.after(async () => {
      assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
      assert.ok(path.basename(root).startsWith("corkoro-web-"));
      await fs.rm(root, { recursive: true, force: true });
    });
    const vault = path.join(root, "Vault");
    await fs.cp(new URL("../fixtures/vault", import.meta.url), vault, {
      recursive: true,
    });
    const config = path.join(vault, "网站/selected.config.json");
    const c = JSON.parse(await fs.readFile(config, "utf8"));
    c.output.directory = path.join(root, "content");
    c.site.address = { origin: "https://example.org", base: "/blog/" };
    c.publication.entries[0].slug = "中文";
    await fs.writeFile(config, JSON.stringify(c));
    const built = await buildContentBundle(config);
    assert.equal(built.ok, true);
    // The renderer must work with only the public package available.
    await fs.rename(vault, path.join(root, "offline-vault"));
    const output = path.join(root, "site");
    const result = await web.buildSite(built.bundlePath, output);
    assert.equal(result.ok, true, JSON.stringify(result));
    const active = await web.readSite(output);
    const home = await fs.readFile(
      path.join(active.siteDirectory, "index.html"),
      "utf8",
    );
    assert.match(home, /href="\/blog\/%E4%B8%AD%E6%96%87\/"/);
    assert.match(home, /https:\/\/example.org\/blog\//);
    const article = await fs.readFile(
      path.join(active.siteDirectory, "中文/index.html"),
      "utf8",
    );
    assert.match(article, /href="\/blog\/related\/"/);
    assert.match(article, /src="\/blog\/assets\//);
    assert.equal(home.includes(vault), false);
    assert.equal(home.includes("私人笔记"), false);
    const before = await fs.readFile(path.join(output, "site.current.json"));
    const inputBefore = await fs.readFile(built.bundlePath);
    await t.test(
      "locked output refuses a second writer without allocating a generation",
      async () => {
        const tx = await openTransaction(
          path.join(output, "site.current.json"),
        );
        const names = await fs.readdir(output);
        try {
          assert.equal(
            (await web.buildSite(built.bundlePath, output)).diagnostics[0].code,
            "OUTPUT_BUSY",
          );
        } finally {
          await tx.close();
        }
        assert.deepEqual(await fs.readdir(output), names);
      },
    );
    await t.test(
      "real Astro failure and cancellation leave the old pointer unchanged",
      async () => {
        const write = fs.writeFile;
        fs.writeFile = async (filename, data, ...args) =>
          write(
            filename,
            String(filename).endsWith("[...slug].astro")
              ? '---\nthrow new Error("injected build failure");\n---\n'
              : data,
            ...args,
          );
        try {
          const failed = await web.buildSite(built.bundlePath, output);
          assert.equal(failed.effect, "none");
          assert.equal(failed.diagnostics[0].code, "SITE_BUILD_FAILED");
          assert.ok(failed.retainedDirectory);
        } finally {
          fs.writeFile = write;
        }
        const controller = new AbortController();
        fs.writeFile = async (...args) => {
          const r = await write(...args);
          if (String(args[0]).endsWith("pages.json")) controller.abort();
          return r;
        };
        try {
          assert.equal(
            (await web.buildSite(built.bundlePath, output, controller.signal))
              .exitCode,
            130,
          );
        } finally {
          fs.writeFile = write;
        }
        assert.deepEqual(
          await fs.readFile(path.join(output, "site.current.json")),
          before,
        );
        assert.deepEqual(await fs.readFile(built.bundlePath), inputBefore);
      },
    );
    await t.test(
      "process exit after staging does not promote an orphan generation",
      async () => {
        const worker = path.join(root, "interrupted.mjs");
        const moduleUrl = new URL(
          "../../dist/apps/web/src/index.js",
          import.meta.url,
        ).href;
        await fs.writeFile(
          worker,
          `import fs from 'node:fs/promises';import {buildSite} from ${JSON.stringify(moduleUrl)};const open=fs.open;fs.open=async(...args)=>{const h=await open(...args);if(String(args[0]).endsWith('.tmp')){const sync=h.sync.bind(h);h.sync=async()=>{await sync();process.exit(17);};}return h;};await buildSite(process.argv[2],process.argv[3]);`,
        );
        const child = spawn(
          process.execPath,
          [worker, built.bundlePath, output],
          { windowsHide: true, stdio: "ignore", cwd: os.tmpdir() },
        );
        assert.equal((await once(child, "close"))[0], 17);
        assert.deepEqual(
          await fs.readFile(path.join(output, "site.current.json")),
          before,
        );
        assert.equal(
          (await web.readSite(output)).siteDirectory,
          active.siteDirectory,
        );
      },
    );
    await t.test(
      "input overlap and a foreign pointer are rejected",
      async () => {
        assert.equal(
          (
            await web.buildSite(
              built.bundlePath,
              path.dirname(built.bundlePath),
            )
          ).diagnostics[0].code,
          "OUTPUT_OVERLAP",
        );
        const foreign = path.join(root, "foreign");
        await fs.mkdir(foreign);
        await fs.writeFile(
          path.join(foreign, "site.current.json"),
          "user data",
        );
        assert.equal(
          (await web.buildSite(built.bundlePath, foreign)).diagnostics[0].code,
          "OUTPUT_NOT_OWNED",
        );
        assert.equal(
          await fs.readFile(path.join(foreign, "site.current.json"), "utf8"),
          "user data",
        );
      },
    );
    await fs.writeFile(built.bundlePath, "{}");
    assert.equal((await web.buildSite(built.bundlePath, output)).ok, false);
    assert.deepEqual(
      await fs.readFile(path.join(output, "site.current.json")),
      before,
    );
    assert.equal(
      (await web.readSite(output)).siteDirectory,
      active.siteDirectory,
    );
    const { buildId: previousId, ...payload } = JSON.parse(inputBefore);
    payload.manifest.site.title = "新版站点";
    payload.manifest.documents[0].route = "/cafe%CC%81/";
    await fs.writeFile(built.bundlePath, JSON.stringify(sealBundle(payload)));
    const replacement = await web.buildSite(built.bundlePath, output);
    assert.equal(replacement.ok, true, JSON.stringify(replacement));
    assert.notEqual(replacement.siteDirectory, active.siteDirectory);
    assert.equal(
      (await web.readSite(output)).siteDirectory,
      replacement.siteDirectory,
    );
    assert.equal(
      await fs.readFile(path.join(active.siteDirectory, "index.html"), "utf8"),
      home,
    );
    assert.match(
      await fs.readFile(
        path.join(replacement.siteDirectory, "index.html"),
        "utf8",
      ),
      /新版站点/,
    );
    assert.match(
      await fs.readFile(
        path.join(replacement.siteDirectory, "index.html"),
        "utf8",
      ),
      /href="\/blog\/caf%C3%A9\/"/,
    );
    assert.ok(
      (
        await fs.stat(path.join(replacement.siteDirectory, "café/index.html"))
      ).isFile(),
    );
    await fs.writeFile(
      path.join(replacement.siteDirectory, "index.html"),
      "tampered",
    );
    await assert.rejects(
      web.readSite(output),
      (e) => e.code === "SITE_CHANGED",
    );
  },
);
