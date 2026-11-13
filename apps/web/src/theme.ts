import type { ContentBundle } from "../../../packages/content-contract/src/bundle.js";
import { contentRenderer, escapeHtml as e } from "./render.js";

export function defaultPages(bundle: ContentBundle) {
  const { render, local } = contentRenderer(bundle);
  const { site, documents, theme } = bundle.manifest;
  const bodies = new Map(bundle.documents.map((d) => [d.id, d.body]));
  const navigation = documents
    .filter((d) => d.kind === "page")
    .map((d) => `<a href="${e(local(d.route))}">${e(d.title)}</a>`)
    .join("");
  const layout = (
    title: string,
    route: string,
    body: string,
  ) => `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(title)} · ${e(site.title)}</title>${site.address ? `<link rel="canonical" href="${e(site.address.origin + local(route))}">` : ""}<style>
  :root{color-scheme:${theme.settings.colorMode === "system" ? "light dark" : theme.settings.colorMode};--accent:${theme.settings.accentColor};font-family:system-ui,sans-serif;line-height:1.75}body{margin:0}header,main,footer{max-width:48rem;margin:auto;padding:1.5rem}nav{display:flex;gap:1rem;flex-wrap:wrap}a{color:var(--accent);overflow-wrap:anywhere}h1,h2,h3{line-height:1.3;overflow-wrap:anywhere}img{max-width:100%;height:auto}pre{overflow:auto;padding:1rem;background:light-dark(#f2f4f7,#222)}blockquote{border-left:3px solid var(--accent);margin-left:0;padding-left:1rem}main{min-height:60vh;overflow-wrap:anywhere}footer{font-size:.85rem;opacity:.7}
  </style></head><body><header><nav><a href="${e(local("/"))}">${e(site.title)}</a>${navigation}${site.friends.length ? `<a href="${e(local("/friends/"))}">友链</a>` : ""}</nav></header><main>${body}</main><footer>由 Corkoro 生成</footer></body></html>`;
  const profile = site.profile
    ? `<section><h2>${e(site.profile.name)}</h2>${site.profile.avatar ? `<img src="${e(local("/assets/" + site.profile.avatar))}" alt="${e(site.profile.name)}" width="96" height="96">` : ""}<p>${e(site.profile.bio)}</p>${site.profile.socials.map((s) => `<a href="${e(s.url)}">${e(s.label)}</a>`).join(" · ")}</section>`
    : "";
  const articles = documents.filter((d) => d.kind === "article");
  const pages = [
    {
      slug: undefined as string | undefined,
      html: layout(
        site.title,
        "/",
        `<h1>${e(site.title)}</h1>${profile}${articles.length ? `<h2>文章</h2><ul>${articles.map((d) => `<li><a href="${e(local(d.route))}">${e(d.title)}</a></li>`).join("")}</ul>` : ""}`,
      ),
    },
  ];
  for (const doc of documents) {
    const slug = decodeURIComponent(doc.route.slice(1, -1)).normalize("NFC");
    // The first writer targets Windows. Reject unrepresentable directory names before Astro runs.
    if (
      /[<>:"\\|?*]/.test(slug) ||
      /[. ]$/.test(slug) ||
      /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(slug)
    )
      throw new Error("SITE_ROUTE_UNSUPPORTED");
    pages.push({
      slug,
      html: layout(
        doc.title,
        doc.route,
        `<article data-content-id="${e(doc.id)}">${render(bodies.get(doc.id)!)}</article>`,
      ),
    });
  }
  if (site.friends.length)
    pages.push({
      slug: "friends",
      html: layout(
        "友链",
        "/friends/",
        `<h1>友链</h1><ul>${site.friends.map((f) => `<li><a href="${e(f.url)}">${e(f.name)}</a>${f.description ? `<p>${e(f.description)}</p>` : ""}</li>`).join("")}</ul>`,
      ),
    });
  return pages;
}
