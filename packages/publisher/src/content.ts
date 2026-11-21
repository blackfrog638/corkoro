import path from "node:path";
import type { Nodes } from "mdast";
import type { Config } from "../../content-contract/src/index.js";
import {
  digestBytes,
  digestJson,
  sealBundle,
  type ContentNode,
  type ContentTarget,
  type BundlePayload,
} from "../../content-contract/src/bundle.js";
import { parseMarkdown } from "./markdown.js";
import type { analyze, CapturedDocument } from "./planning.js";
import { Failure } from "./errors.js";

type Analysis = Awaited<ReturnType<typeof analyze>>;
const escapeLabel = (s: string) => s.replace(/[!-/:-@\[-`{-~]/g, "\\$&");

function convertDocument(doc: CapturedDocument, assetIds: Map<string, string>) {
  const source = new TextDecoder("utf-8", { fatal: true }).decode(doc.bytes);
  const resolved = new Map<number, CapturedDocument["links"][number]>();
  let normalized = "",
    cursor = 0,
    shift = 0;
  for (const link of doc.links) {
    const ref = link.reference;
    resolved.set(ref.start + shift, link);
    if (!ref.wiki) continue;
    const raw = source.slice(ref.start + (ref.embed ? 3 : 2), ref.end - 2);
    const separator = raw.indexOf("|");
    const label = separator < 0 ? raw : raw.slice(separator + 1);
    const replacement = `${ref.embed ? "!" : ""}[${escapeLabel(label)}](corkoro-reference)`;
    normalized += source.slice(cursor, ref.start) + replacement;
    shift += replacement.length - (ref.end - ref.start);
    cursor = ref.end;
  }
  normalized += source.slice(cursor);
  const tree = cursor
    ? parseMarkdown(normalized, "markdown").tree
    : doc.parsed.tree;
  const definitions = new Map<string, string | null>();
  const visit = (n: Nodes) => {
    if (n.type === "definition" && !definitions.has(n.identifier))
      definitions.set(n.identifier, n.title ?? null);
    if ("children" in n) n.children.forEach(visit);
  };
  visit(tree);
  const consumed = new Set<number>();
  const fail = (): never => {
    throw new Failure("CONTENT_CONVERSION_FAILED", 3);
  };
  function target(n: Nodes): ContentTarget {
    const offset = n.position?.start.offset;
    const link = offset === undefined ? undefined : resolved.get(offset);
    if (!link) return fail();
    consumed.add(offset!);
    if (link.targetId) return { kind: "document", id: link.targetId };
    if (link.asset) {
      const id = assetIds.get(`${link.asset.assetRoot}:${link.asset.path}`);
      return id ? { kind: "asset", id } : fail();
    }
    return link.url !== null ? { kind: "external", url: link.url } : fail();
  }
  function convert(n: Nodes): ContentNode[] {
    const children = () => ("children" in n ? n.children.flatMap(convert) : []);
    switch (n.type) {
      case "yaml":
      case "toml":
      case "definition":
        return [];
      case "root":
      case "paragraph":
      case "blockquote":
      case "emphasis":
      case "strong":
        return [{ type: n.type, children: children() }];
      case "heading":
        return [{ type: "heading", depth: n.depth, children: children() }];
      case "list":
        return [
          {
            type: "list",
            ordered: n.ordered ?? false,
            start: n.start ?? null,
            spread: n.spread ?? false,
            children: children(),
          },
        ];
      case "listItem":
        return [
          { type: "listItem", spread: n.spread ?? false, children: children() },
        ];
      case "text":
      case "inlineCode":
        return [{ type: n.type, value: n.value }];
      case "code":
        return [{ type: "code", value: n.value, lang: n.lang ?? null }];
      case "break":
      case "thematicBreak":
        return [{ type: n.type }];
      case "link":
        return [
          {
            type: "link",
            target: target(n),
            title: n.title ?? null,
            children: children(),
          },
        ];
      case "linkReference":
        return [
          {
            type: "link",
            target: target(n),
            title: definitions.get(n.identifier) ?? null,
            children: children(),
          },
        ];
      case "image":
        return [
          {
            type: "image",
            target: target(n),
            title: n.title ?? null,
            alt: n.alt ?? "",
          },
        ];
      case "imageReference":
        return [
          {
            type: "image",
            target: target(n),
            title: definitions.get(n.identifier) ?? null,
            alt: n.alt ?? "",
          },
        ];
      default:
        return fail();
    }
  }
  const body = convert(tree)[0]!;
  if (consumed.size !== doc.links.length) fail();
  const plain = (n: ContentNode): string =>
    "value" in n
      ? n.value
      : "children" in n
        ? n.children.map(plain).join("")
        : n.type === "image"
          ? n.alt
          : "";
  const heading =
    body.type === "root"
      ? body.children.find((n) => n.type === "heading" && n.depth === 1)
      : undefined;
  const title = heading ? plain(heading).trim() || doc.id : doc.id;
  return { body, title };
}

export function createContentBundle(config: Config, analysis: Analysis) {
  if (!analysis.plan.buildable || !analysis.plan.complete)
    throw new Failure("CONTENT_BLOCKED", 3);
  const payload: BundlePayload = {
    format: "corkoro-content",
    schemaVersion: 1,
    manifest: {
      site: {
        title: config.site.title,
        ...(config.site.address
          ? { address: structuredClone(config.site.address) }
          : {}),
        ...(config.site.commentsOrigin
          ? { commentsOrigin: config.site.commentsOrigin }
          : {}),
        profile: null,
        friends: structuredClone(config.site.friends),
      },
      theme: structuredClone(config.theme),
      documents: [],
      assets: [],
    },
    documents: [],
    assets: [],
  };
  const assetIds = new Map<string, string>(),
    added = new Set<string>();
  for (const a of analysis.plan.assets) {
    const key = `${a.assetRoot}:${a.path}`,
      bytes = analysis.assets.get(key)!;
    const ext = path.extname(a.path).toLowerCase();
    const id = digestBytes(bytes).slice(7) + ext;
    assetIds.set(key, id);
    if (added.has(id)) continue;
    added.add(id);
    const mediaType =
      ext === ".svg"
        ? "image/svg+xml"
        : [".jpg", ".jpeg"].includes(ext)
          ? "image/jpeg"
          : (`image/${ext.slice(1)}` as
              | "image/png"
              | "image/gif"
              | "image/webp");
    payload.manifest.assets.push({ id, mediaType, byteLength: bytes.length });
    payload.assets.push({ id, base64: bytes.toString("base64") });
  }
  payload.assets.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  payload.manifest.assets.sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
  if (config.site.profile) {
    const { avatar, ...profile } = config.site.profile;
    payload.manifest.site.profile = structuredClone(profile);
    if (avatar) {
      const a = analysis.plan.assets.find((a) =>
        a.reasons.some((r) => r.field === "/site/profile/avatar"),
      )!;
      payload.manifest.site.profile.avatar = assetIds.get(
        `${a.assetRoot}:${a.path}`,
      )!;
    }
  }
  const articles = new Map(analysis.plan.articles.map((a) => [a.id, a]));
  const pages = new Map(analysis.plan.pages.map((p) => [p.id, p]));
  for (const doc of analysis.documents.values()) {
    const { body, title } = convertDocument(doc, assetIds);
    const article = articles.get(doc.id);
    const segment = article
      ? article.slug
      : pages.get(doc.id)!.route.slice(1, -1);
    payload.documents.push({ id: doc.id, body });
    payload.manifest.documents.push({
      id: doc.id,
      kind: article ? "article" : "page",
      route: `/${encodeURIComponent(segment)}/`,
      title,
      contentHash: digestJson(body),
    });
  }
  return sealBundle(payload);
}
