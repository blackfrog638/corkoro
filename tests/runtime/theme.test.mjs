import test from "node:test";
import assert from "node:assert/strict";
import {
  sealBundle,
  digestJson,
} from "../../dist/packages/content-contract/src/bundle.js";
import { defaultPages } from "../../dist/apps/web/src/theme.js";

function sample({
  article = true,
  profile = null,
  friends = [],
  mode = "system",
} = {}) {
  const body = {
    type: "root",
    children: [
      {
        type: "paragraph",
        children: [{ type: "text", value: "正文 <script>不是代码</script>" }],
      },
    ],
  };
  return sealBundle({
    format: "corkoro-content",
    schemaVersion: 1,
    manifest: {
      site: {
        title: "测试站点",
        profile,
        friends,
        address: { origin: "https://example.org", base: "/blog/" },
      },
      theme: {
        name: "default",
        settings: { colorMode: mode, accentColor: "#ffffff" },
      },
      documents: [
        {
          id: "entry",
          kind: article ? "article" : "page",
          title: "没有一级标题的内容",
          route: "/entry/",
          contentHash: digestJson(body),
        },
      ],
      assets: [],
    },
    documents: [{ id: "entry", body }],
    assets: [],
  });
}
test("default theme supplies accessible navigation and a title for a headingless document", () => {
  const pages = defaultPages(sample());
  const home = pages[0].html,
    article = pages[1].html;
  assert.match(home, /<title>测试站点<\/title>/);
  assert.match(home, /href="#main-content"/);
  assert.match(home, /aria-current="page"/);
  assert.match(article, /<h1>没有一级标题的内容<\/h1>/);
  assert.match(article, /&lt;script&gt;不是代码&lt;\/script&gt;/);
  assert.doesNotMatch(article, /<script>/);
  assert.match(home, /href="\/blog\/entry\/"/);
});
test("page-only sites hide the article section; profile and friends are optional and escaped", () => {
  const pages = defaultPages(
    sample({
      article: false,
      profile: { name: "作者 <b>", bio: "简介", socials: [] },
      friends: [
        { name: "友链 <x>", url: "https://example.net", description: "说明" },
      ],
    }),
  );
  assert.doesNotMatch(pages[0].html, /id="articles"/);
  assert.match(pages[0].html, /作者 &lt;b&gt;/);
  assert.doesNotMatch(pages[0].html, /<img/);
  assert.match(pages.find((p) => p.slug === "friends").html, /友链 &lt;x&gt;/);
  assert.match(pages[1].html, /aria-current="page"[^>]*>没有一级标题的内容/);
  assert.equal(
    defaultPages(sample()).some((p) => p.slug === "friends"),
    false,
  );
});
test("theme honors all configured color modes and does not mutate the public package", () => {
  for (const mode of ["light", "dark", "system"]) {
    const bundle = sample({ mode }),
      before = JSON.stringify(bundle);
    assert.match(
      defaultPages(bundle)[0].html,
      new RegExp(`color-scheme:${mode === "system" ? "light dark" : mode}`),
    );
    assert.equal(JSON.stringify(bundle), before);
  }
});

test("profile-only and friend-only sites render without article placeholders", () => {
  for (const site of [
    { profile: { name: "作者", bio: "公开资料", socials: [] }, friends: [] },
    { profile: null, friends: [{ name: "朋友", url: "https://example.net" }] },
  ]) {
    const { buildId, ...payload } = sample(site);
    payload.documents = [];
    payload.manifest.documents = [];
    const pages = defaultPages(sealBundle(payload));
    assert.doesNotMatch(pages[0].html, /id="articles"/);
    if (site.profile) assert.match(pages[0].html, /公开资料/);
    else assert.ok(pages.find((p) => p.slug === "friends"));
  }
});
