import type {
  ContentBundle,
  ContentNode,
} from "../../../packages/content-contract/src/bundle.js";
import { contentRenderer, escapeHtml as e } from "./render.js";
import { defaultStyles } from "./theme-styles.js";

function plainText(node: ContentNode): string {
  if ("value" in node) return node.value;
  if ("children" in node) return node.children.map(plainText).join("");
  return node.type === "image" ? node.alt : " ";
}

export function defaultPages(bundle: ContentBundle) {
  const { render, local } = contentRenderer(bundle);
  const { site, documents, theme } = bundle.manifest;
  const bodies = new Map(bundle.documents.map((d) => [d.id, d.body]));
  const navItems = [
    { title: "首页", route: "/" },
    ...documents.filter((d) => d.kind === "page"),
    ...(site.friends.length ? [{ title: "友链", route: "/friends/" }] : []),
  ];
  const layout = (title: string, route: string, body: string) => {
    const navigation = navItems
      .map(
        (item) =>
          `<a href="${e(local(item.route))}"${local(item.route) === local(route) ? ' aria-current="page"' : ""}>${e(item.title)}</a>`,
      )
      .join("");
    return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(route === "/" ? site.title : title + " · " + site.title)}</title>${site.address ? `<link rel="canonical" href="${e(site.address.origin + local(route))}">` : ""}<style>:root{color-scheme:${theme.settings.colorMode === "system" ? "light dark" : theme.settings.colorMode};--accent:${theme.settings.accentColor}}${defaultStyles}</style></head><body><a class="skip-link" href="#main-content">跳到正文</a><header class="shell site-header"><a class="brand" href="${e(local("/"))}">${e(site.title)}</a><nav aria-label="主导航">${navigation}</nav></header><main id="main-content" class="shell" tabindex="-1">${body}</main><footer class="shell site-footer"><span>${e(site.title)}</span><span>由 Corkoro 生成</span></footer></body></html>`;
  };
  const profile = site.profile
    ? `<aside class="profile" aria-label="作者资料">${site.profile.avatar ? `<img class="avatar" src="${e(local("/assets/" + site.profile.avatar))}" alt="${e(site.profile.name)}" width="68" height="68">` : ""}<h2>${e(site.profile.name)}</h2><p>${e(site.profile.bio)}</p>${site.profile.socials.length ? `<div class="socials">${site.profile.socials.map((s) => `<a href="${e(s.url)}">${e(s.label)}</a>`).join("")}</div>` : ""}</aside>`
    : "";
  const articles = documents.filter((d) => d.kind === "article");
  const articleList = articles.length
    ? `<section id="articles" aria-labelledby="articles-title"><div class="section-title"><h2 id="articles-title">文章</h2><span>${articles.length} 篇</span></div><ol class="article-list">${articles
        .map((doc, index) => {
          const body = bodies.get(doc.id)!;
          const paragraph =
            "children" in body
              ? body.children.find((n) => n.type === "paragraph")
              : undefined;
          const text = paragraph
            ? plainText(paragraph).replace(/\s+/g, " ").trim()
            : "";
          const characters = Array.from(text);
          const excerpt =
            characters.slice(0, 140).join("") +
            (characters.length > 140 ? "…" : "");
          return `<li class="article-row"><span class="article-number" aria-hidden="true">${String(index + 1).padStart(2, "0")}</span><div><h3><a href="${e(local(doc.route))}">${e(doc.title)}</a></h3>${excerpt ? `<p>${e(excerpt)}</p>` : ""}</div></li>`;
        })
        .join("")}</ol></section>`
    : "";
  const pages = [
    {
      slug: undefined as string | undefined,
      html: layout(
        site.title,
        "/",
        `<div class="home-heading"><p class="eyebrow">文字与记录</p><h1>${e(site.title)}</h1></div><div class="home-grid${articles.length && profile ? " with-profile" : ""}">${articleList}${profile}</div>`,
      ),
    },
  ];
  for (const doc of documents) {
    const slug = decodeURIComponent(doc.route.slice(1, -1)).normalize("NFC");
    // Windows cannot represent these route directory names.
    if (
      /[<>:"\\|?*]/.test(slug) ||
      /[. ]$/.test(slug) ||
      /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(slug)
    )
      throw new Error("SITE_ROUTE_UNSUPPORTED");
    const body = bodies.get(doc.id)!;
    const hasTitle =
      "children" in body &&
      body.children.some((n) => n.type === "heading" && n.depth === 1);
    pages.push({
      slug,
      html: layout(
        doc.title,
        doc.route,
        `<div class="reading"><a class="back-link" href="${e(local("/"))}">← 返回首页</a><article class="prose" data-content-id="${e(doc.id)}"><p class="eyebrow">${doc.kind === "article" ? "文章" : "页面"}</p>${hasTitle ? "" : `<h1>${e(doc.title)}</h1>`}${render(body)}</article></div>`,
      ),
    });
  }
  if (site.friends.length)
    pages.push({
      slug: "friends",
      html: layout(
        "友链",
        "/friends/",
        `<div class="reading"><p class="eyebrow">友链</p><h1>在别处相遇</h1><ul class="friend-list">${site.friends.map((f) => `<li><h2><a href="${e(f.url)}">${e(f.name)}</a></h2>${f.description ? `<p>${e(f.description)}</p>` : ""}</li>`).join("")}</ul></div>`,
      ),
    });
  return pages;
}
