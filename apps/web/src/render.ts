import type {
  ContentBundle,
  ContentNode,
  ContentTarget,
} from "../../../packages/content-contract/src/bundle.js";

const htmlEntities: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};
export const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (c) => htmlEntities[c]!);

export function contentRenderer(bundle: ContentBundle) {
  const base = bundle.manifest.site.address?.base ?? "/";
  const routes = new Map(bundle.manifest.documents.map((d) => [d.id, d.route]));
  const local = (route: string) =>
    base +
    route
      .slice(1)
      .split("/")
      .map((segment) =>
        encodeURIComponent(decodeURIComponent(segment).normalize("NFC")),
      )
      .join("/");
  const target = (t: ContentTarget): string => {
    if (t.kind === "external") return t.url;
    if (t.kind === "asset") return local(`/assets/${t.id}`);
    const route = routes.get(t.id);
    if (!route) throw new Error("Missing document route");
    return local(route);
  };
  function render(n: ContentNode): string {
    const children = () =>
      "children" in n ? n.children.map(render).join("") : "";
    const tag = (name: string, attrs = "") =>
      `<${name}${attrs}>${children()}</${name}>`;
    switch (n.type) {
      case "root":
        return children();
      case "text":
        return escapeHtml(n.value);
      case "inlineCode":
        return `<code>${escapeHtml(n.value)}</code>`;
      case "code":
        return `<pre><code${n.lang ? ` class="language-${escapeHtml(n.lang)}"` : ""}>${escapeHtml(n.value)}</code></pre>`;
      case "paragraph":
        return tag("p");
      case "heading":
        return tag(`h${n.depth}`);
      case "blockquote":
        return tag("blockquote");
      case "emphasis":
        return tag("em");
      case "strong":
        return tag("strong");
      case "list":
        return tag(
          n.ordered ? "ol" : "ul",
          n.ordered && n.start !== null ? ` start="${n.start}"` : "",
        );
      case "listItem":
        return tag("li");
      case "break":
        return "<br>";
      case "thematicBreak":
        return "<hr>";
      case "link":
        return tag(
          "a",
          ` href="${escapeHtml(target(n.target))}"${n.title === null ? "" : ` title="${escapeHtml(n.title)}"`}`,
        );
      case "image":
        return `<img src="${escapeHtml(target(n.target))}" alt="${escapeHtml(n.alt)}"${n.title === null ? "" : ` title="${escapeHtml(n.title)}"`} loading="lazy">`;
    }
  }
  return { render, local };
}
