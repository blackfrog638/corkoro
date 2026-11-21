import { createHash } from "node:crypto";
import { z } from "zod";
import { commentsOriginSchema, siteAddressSchema } from "./site.js";
import {
  configSchema,
  diagnosticSchema,
  friendSchema,
  idSchema,
  profileSchema,
  routeKey,
  slugSchema,
  text,
} from "./index.js";

const sha256 = z.string().regex(/^sha256:[a-f0-9]{64}$/);
export const assetIdSchema = z
  .string()
  .regex(/^[a-f0-9]{64}\.(png|jpg|jpeg|gif|webp|svg)$/);
function urlProtocol(value: string) {
  try {
    return new URL(value.startsWith("//") ? `https:${value}` : value).protocol;
  } catch {
    return null;
  }
}
const externalUrl = z
  .string()
  .refine((value) =>
    ["http:", "https:", "mailto:"].includes(urlProtocol(value) ?? ""),
  );
export const contentTargetSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("document"), id: idSchema }),
  z.strictObject({ kind: z.literal("asset"), id: assetIdSchema }),
  z.strictObject({ kind: z.literal("external"), url: externalUrl }),
]);
export type ContentTarget = z.infer<typeof contentTargetSchema>;
export type ContentNode =
  | {
      type: "root" | "paragraph" | "blockquote" | "emphasis" | "strong";
      children: ContentNode[];
    }
  | { type: "heading"; depth: number; children: ContentNode[] }
  | {
      type: "list";
      ordered: boolean;
      start: number | null;
      spread: boolean;
      children: ContentNode[];
    }
  | { type: "listItem"; spread: boolean; children: ContentNode[] }
  | { type: "text" | "inlineCode"; value: string }
  | { type: "code"; value: string; lang: string | null }
  | { type: "break" | "thematicBreak" }
  | {
      type: "link";
      target: ContentTarget;
      title: string | null;
      children: ContentNode[];
    }
  | { type: "image"; target: ContentTarget; title: string | null; alt: string };
export const contentNodeSchema: z.ZodType<ContentNode> = z.lazy(() =>
  z.discriminatedUnion("type", [
    z.strictObject({
      type: z.enum(["root", "paragraph", "blockquote", "emphasis", "strong"]),
      children: z.array(contentNodeSchema),
    }),
    z.strictObject({
      type: z.literal("heading"),
      depth: z.number().int().min(1).max(6),
      children: z.array(contentNodeSchema),
    }),
    z.strictObject({
      type: z.literal("list"),
      ordered: z.boolean(),
      start: z.number().int().nonnegative().nullable(),
      spread: z.boolean(),
      children: z.array(contentNodeSchema),
    }),
    z.strictObject({
      type: z.literal("listItem"),
      spread: z.boolean(),
      children: z.array(contentNodeSchema),
    }),
    z.strictObject({ type: z.enum(["text", "inlineCode"]), value: z.string() }),
    z.strictObject({
      type: z.literal("code"),
      value: z.string(),
      lang: z.string().nullable(),
    }),
    z.strictObject({ type: z.enum(["break", "thematicBreak"]) }),
    z.strictObject({
      type: z.literal("link"),
      target: contentTargetSchema,
      title: z.string().nullable(),
      children: z.array(contentNodeSchema),
    }),
    z.strictObject({
      type: z.literal("image"),
      target: contentTargetSchema,
      title: z.string().nullable(),
      alt: z.string(),
    }),
  ]),
);
const publicRoute = z.string().refine((value) => {
  try {
    const slug = decodeURIComponent(value.slice(1, -1));
    return (
      value === `/${encodeURIComponent(slug)}/` &&
      slugSchema.safeParse(slug).success &&
      !["friends", "search"].includes(routeKey(slug))
    );
  } catch {
    return false;
  }
});
export const manifestSchema = z.strictObject({
  site: z.strictObject({
    title: text,
    address: siteAddressSchema.optional(),
    commentsOrigin: commentsOriginSchema.optional(),
    profile: profileSchema
      .omit({ avatar: true })
      .extend({ avatar: assetIdSchema.optional() })
      .nullable(),
    friends: z.array(friendSchema),
  }),
  theme: configSchema.shape.theme,
  documents: z.array(
    z.strictObject({
      id: idSchema,
      kind: z.enum(["article", "page"]),
      route: publicRoute,
      title: text,
      contentHash: sha256,
    }),
  ),
  assets: z.array(
    z.strictObject({
      id: assetIdSchema,
      mediaType: z.enum([
        "image/png",
        "image/jpeg",
        "image/gif",
        "image/webp",
        "image/svg+xml",
      ]),
      byteLength: z.number().int().nonnegative(),
    }),
  ),
});
const bundlePayloadSchema = z.strictObject({
  format: z.literal("corkoro-content"),
  schemaVersion: z.literal(1),
  manifest: manifestSchema,
  documents: z.array(
    z.strictObject({
      id: idSchema,
      body: contentNodeSchema.refine((n) => n.type === "root"),
    }),
  ),
  assets: z.array(z.strictObject({ id: assetIdSchema, base64: z.string() })),
});
export type BundlePayload = z.infer<typeof bundlePayloadSchema>;
export const digestBytes = (bytes: Uint8Array) =>
  "sha256:" + createHash("sha256").update(bytes).digest("hex");
export const digestJson = (value: unknown) =>
  digestBytes(Buffer.from(JSON.stringify(value)));
export const bundleSchema = bundlePayloadSchema
  .extend({ buildId: sha256 })
  .superRefine((bundle, ctx) => {
    const invalid = (message: string) =>
      ctx.addIssue({ code: "custom", message });
    const { buildId, ...payload } = bundle;
    if (digestJson(payload) !== buildId) invalid("Bundle digest mismatch");
    const docs = new Map(bundle.documents.map((d) => [d.id, d]));
    const assets = new Map(bundle.assets.map((a) => [a.id, a]));
    if (
      docs.size !== bundle.documents.length ||
      assets.size !== bundle.assets.length
    )
      invalid("Duplicate content identity");
    if (
      bundle.manifest.documents.length !== docs.size ||
      bundle.manifest.assets.length !== assets.size
    )
      invalid("Manifest inventory mismatch");
    const ids = new Set<string>(),
      routes = new Set<string>(),
      assetIds = new Set<string>();
    for (const d of bundle.manifest.documents) {
      if (ids.has(d.id)) invalid("Duplicate document identity");
      ids.add(d.id);
      try {
        const key = routeKey(decodeURIComponent(d.route));
        if (routes.has(key)) invalid("Duplicate document route");
        routes.add(key);
      } catch {
        invalid("Invalid encoded route");
      }
      if (!docs.has(d.id) || digestJson(docs.get(d.id)!.body) !== d.contentHash)
        invalid("Document digest mismatch");
    }
    for (const a of bundle.manifest.assets) {
      if (assetIds.has(a.id)) invalid("Duplicate asset");
      assetIds.add(a.id);
      const data = assets.get(a.id);
      if (!data) {
        invalid("Missing asset");
        continue;
      }
      const bytes = Buffer.from(data.base64, "base64");
      if (
        bytes.toString("base64") !== data.base64 ||
        bytes.length !== a.byteLength ||
        digestBytes(bytes).slice(7) !== a.id.split(".")[0]
      )
        invalid("Asset digest mismatch");
      const ext = a.id.split(".")[1]!;
      const media =
        ext === "svg"
          ? "image/svg+xml"
          : ["jpg", "jpeg"].includes(ext)
            ? "image/jpeg"
            : `image/${ext}`;
      if (a.mediaType !== media) invalid("Asset media type mismatch");
    }
    const usedAssets = new Set<string>();
    const walk = (n: ContentNode) => {
      if ("target" in n) {
        if (
          n.target.kind === "document" &&
          (!ids.has(n.target.id) || n.type === "image")
        )
          invalid("Invalid document reference");
        if (n.target.kind === "asset") {
          usedAssets.add(n.target.id);
          if (!assetIds.has(n.target.id)) invalid("Missing referenced asset");
        }
        if (
          n.type === "image" &&
          n.target.kind === "external" &&
          urlProtocol(n.target.url) === "mailto:"
        )
          invalid("Invalid image URL");
      }
      if ("children" in n) n.children.forEach(walk);
    };
    bundle.documents.forEach((d) => walk(d.body));
    const avatar = bundle.manifest.site.profile?.avatar;
    if (avatar) {
      usedAssets.add(avatar);
      if (!assetIds.has(avatar)) invalid("Missing avatar");
    }
    if (assetIds.size !== usedAssets.size) invalid("Unreferenced asset");
    if (
      !docs.size &&
      !bundle.manifest.site.profile &&
      !bundle.manifest.site.friends.length
    )
      invalid("Empty bundle");
  });
export type ContentBundle = z.infer<typeof bundleSchema>;
export function sealBundle(payload: BundlePayload): ContentBundle {
  const normalized = bundlePayloadSchema.parse(payload);
  return bundleSchema.parse({ ...normalized, buildId: digestJson(normalized) });
}

export const bundleResultSchema = z
  .strictObject({
    ok: z.boolean(),
    exitCode: z.union([
      z.literal(0),
      z.literal(1),
      z.literal(2),
      z.literal(3),
      z.literal(4),
      z.literal(5),
      z.literal(130),
    ]),
    effect: z.enum(["none", "committed", "unknown"]),
    bundlePath: z.string().nullable(),
    buildId: sha256.nullable(),
    diagnostics: z.array(diagnosticSchema),
  })
  .superRefine((r, ctx) => {
    if (
      r.ok !== (r.exitCode === 0) ||
      (r.ok && (!r.bundlePath || !r.buildId)) ||
      (r.effect === "unknown" && (r.exitCode !== 5 || r.buildId !== null)) ||
      (r.exitCode === 130 && r.effect !== "none")
    )
      ctx.addIssue({ code: "custom", message: "Invalid bundle result" });
  });
export type BundleResult = z.infer<typeof bundleResultSchema>;
