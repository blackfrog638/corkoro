import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildSearch } from "../../dist/apps/web/src/search.js";
import {
  sealBundle,
  digestJson,
} from "../../dist/packages/content-contract/src/bundle.js";
test("search indexes only explicit public documents and handles cancellation and empty sites", async () => {
  const body = {
    type: "root",
    children: [
      {
        type: "paragraph",
        children: [{ type: "text", value: "公开的中文内容 searchable" }],
      },
    ],
  };
  const bundle = sealBundle({
    format: "corkoro-content",
    schemaVersion: 1,
    manifest: {
      site: {
        title: "测试",
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
          title: "中文标题",
          route: "/%E4%B8%AD%E6%96%87/",
          contentHash: digestJson(body),
        },
      ],
      assets: [],
    },
    documents: [{ id: "a", body }],
    assets: [],
  });
  const output = await fs.mkdtemp(path.join(os.tmpdir(), "corkoro-search-"));
  try {
    await buildSearch(bundle, output);
    const entry = JSON.parse(
      await fs.readFile(
        path.join(output, "pagefind/pagefind-entry.json"),
        "utf8",
      ),
    );
    assert.equal(
      Object.values(entry.languages).reduce((n, l) => n + l.page_count, 0),
      bundle.documents.length,
    );
    assert.ok(
      (await fs.stat(path.join(output, "pagefind/pagefind.js"))).isFile(),
    );
    await assert.rejects(
      buildSearch(bundle, output, AbortSignal.abort()),
      /CANCELLED/,
    );
    const empty = path.join(output, "empty");
    await buildSearch({ ...bundle, documents: [] }, empty);
    await assert.rejects(fs.stat(empty), { code: "ENOENT" });
  } finally {
    await fs.rm(output, { recursive: true, force: true });
  }
});
