import { z } from "zod";
import { visit } from "jsonc-parser";
import path from "node:path";

export const excluded = new Set([
  ".git",
  ".obsidian",
  ".trash",
  "node_modules",
  ".corkoro-state",
]);
export const text = z
  .string()
  .refine((s) => s.trim().length > 0, "Expected nonempty text");
export const filePath = z
  .string()
  .min(1)
  .refine((s) => !/[\x00-\x1f]/.test(s), "Invalid path");
export const idSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/);
export const slugSchema = z
  .string()
  .min(1)
  .refine(
    (s) =>
      s === s.trim() &&
      !/[\/\\?#%\x00-\x1f\x7f]/.test(s) &&
      ![".", ".."].includes(s),
    "Invalid slug",
  );
export const sourceSchema = filePath.refine(
  (s) =>
    !path.isAbsolute(s) &&
    !s.includes("\\") &&
    !s.includes(":") &&
    s.endsWith(".md") &&
    s.split("/").every((x) => x && x !== "." && x !== ".." && !excluded.has(x)),
  "Invalid source",
);
export const entrySchema = z.strictObject({
  source: sourceSchema,
  id: idSchema,
  slug: slugSchema,
  publish: z.boolean(),
});
const url = z
  .url()
  .refine(
    (s) => ["https:", "http:"].includes(new URL(s).protocol),
    "Expected HTTP(S) URL",
  );
export const profileSchema = z.strictObject({
  name: text,
  bio: text,
  avatar: filePath.optional(),
  socials: z.array(z.strictObject({ label: text, url })),
});
export const friendSchema = z.strictObject({
  name: text,
  url,
  description: z.string().optional(),
});
const pageSchema = z.strictObject({
  id: idSchema,
  source: filePath.refine((s) => s.endsWith(".md")),
  route: z
    .string()
    .refine(
      (s) =>
        s.startsWith("/") &&
        s.endsWith("/") &&
        slugSchema.safeParse(s.slice(1, -1)).success,
    ),
  publish: z.boolean(),
});
export const routeKey = (s: string) => s.normalize("NFC").toLowerCase();
export const configSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    source: z.strictObject({
      root: filePath,
      format: z.enum(["markdown", "obsidian-markdown"]),
      assetRoots: z.array(filePath),
    }),
    publication: z.strictObject({ entries: z.array(entrySchema) }),
    site: z.strictObject({
      title: text,
      profile: profileSchema.nullable(),
      pages: z.array(pageSchema),
      friends: z.array(friendSchema),
    }),
    theme: z.strictObject({
      name: z.literal("default"),
      settings: z.strictObject({
        colorMode: z.enum(["system", "light", "dark"]),
        accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
      }),
    }),
    output: z.strictObject({ directory: filePath }),
  })
  .superRefine((c, ctx) => {
    const ids = new Set<string>(),
      routes = new Set(["/", "/friends/", "/search/"]),
      sources = new Set<string>();
    const add = (
      value: string,
      set: Set<string>,
      field: (string | number)[],
    ) => {
      if (set.has(value))
        ctx.addIssue({
          code: "custom",
          message: "Duplicate or reserved value",
          path: field,
        });
      set.add(value);
    };
    c.publication.entries.forEach((e, i) => {
      add(e.id, ids, ["publication", "entries", i, "id"]);
      add(routeKey(`/${e.slug}/`), routes, [
        "publication",
        "entries",
        i,
        "slug",
      ]);
      add(e.source, sources, ["publication", "entries", i, "source"]);
    });
    c.site.pages.forEach((p, i) => {
      add(p.id, ids, ["site", "pages", i, "id"]);
      add(routeKey(p.route), routes, ["site", "pages", i, "route"]);
    });
  });
export type Config = z.infer<typeof configSchema>;
export type Entry = z.infer<typeof entrySchema>;
export const commandSchema = z.enum([
  "inspect",
  "init",
  "content list",
  "content add",
  "content remove",
  "check",
  "plan",
]);
export type Command = z.infer<typeof commandSchema>;
export const diagnosticSchema = z.strictObject({
  code: z.string(),
  severity: z.enum(["error", "warning", "info"]),
  message: z.string(),
  location: z
    .strictObject({
      kind: z.enum(["config", "source", "asset"]),
      path: z.string(),
      assetRoot: z.number().int().nonnegative().nullable(),
      pointer: z.string().nullable(),
      line: z.number().int().positive().nullable(),
      column: z.number().int().positive().nullable(),
    })
    .nullable(),
});
export type Diagnostic = z.infer<typeof diagnosticSchema>;
const checks = z.enum([
  "config",
  "selection",
  "site",
  "theme",
  "paths",
  "references",
]);
export const checkSchema = z
  .strictObject({
    selectedCount: z.number().int().nonnegative(),
    pageCount: z.number().int().nonnegative(),
    hasProfile: z.boolean(),
    friendCount: z.number().int().nonnegative(),
    passedChecks: z.array(checks),
    failedChecks: z.array(checks),
    unperformedChecks: z.array(checks),
    complete: z.boolean(),
    buildable: z.boolean().nullable(),
  })
  .superRefine((v, c) => {
    const all = [...v.passedChecks, ...v.failedChecks, ...v.unperformedChecks];
    if (
      all.length !== 6 ||
      new Set(all).size !== 6 ||
      v.complete !== (v.unperformedChecks.length === 0)
    )
      c.addIssue({ code: "custom", message: "Invalid check partition" });
    if (
      v.buildable === true &&
      (!v.complete ||
        v.failedChecks.length ||
        !(v.selectedCount || v.pageCount || v.hasProfile || v.friendCount))
    )
      c.addIssue({ code: "custom", message: "Invalid buildable claim" });
  });
export type CheckData = z.infer<typeof checkSchema>;
export const reasonSchema = z.strictObject({
  code: z.enum([
    "SELECTED_ARTICLE",
    "SELECTED_PAGE",
    "EXPLICIT_PROFILE",
    "EXPLICIT_FRIEND",
    "REFERENCED_ASSET",
  ]),
  fromId: idSchema.nullable(),
  field: z.string().nullable(),
});
export type Reason = z.infer<typeof reasonSchema>;
export const planSchema = z
  .strictObject({
    articles: z.array(
      z.strictObject({
        id: idSchema,
        source: z.string(),
        slug: slugSchema,
        reason: reasonSchema,
      }),
    ),
    pages: z.array(
      z.strictObject({
        id: idSchema,
        source: z.string(),
        route: pageSchema.shape.route,
        reason: reasonSchema,
      }),
    ),
    profile: z
      .strictObject({ value: profileSchema, reason: reasonSchema })
      .nullable(),
    friends: z.array(
      z.strictObject({ value: friendSchema, reason: reasonSchema }),
    ),
    assets: z.array(
      z.strictObject({
        assetRoot: z.number().int().nonnegative(),
        path: z.string(),
        reasons: z.array(reasonSchema).min(1),
      }),
    ),
    blockedReferences: z.array(
      z.strictObject({
        fromId: idSchema,
        target: z.string(),
        code: z.string(),
        line: z.number().int().positive().nullable(),
        column: z.number().int().positive().nullable(),
      }),
    ),
    changes: z.null(),
    complete: z.boolean(),
    buildable: z.boolean().nullable(),
  })
  .superRefine((v, ctx) => {
    if (
      v.buildable === true &&
      (!v.complete ||
        v.blockedReferences.length ||
        !(v.articles.length || v.pages.length || v.profile || v.friends.length))
    )
      ctx.addIssue({ code: "custom", message: "Invalid buildable plan" });
  });
export type PlanData = z.infer<typeof planSchema>;
export const inspectSchema = z.strictObject({
  inventory: z.array(
    z.strictObject({
      source: z.string(),
      kind: z.enum(["markdown", "asset", "other"]),
      publishHint: z.boolean().nullable(),
      syntax: z.array(
        z.enum([
          "markdown-link",
          "markdown-image",
          "wikilink",
          "embed",
          "other",
        ]),
      ),
    }),
  ),
  complete: z.boolean(),
  skipped: z.array(
    z.strictObject({
      source: z.string(),
      reason: z.enum(["system", "symlink", "transaction"]),
    }),
  ),
  unexamined: z.array(z.strictObject({ source: z.string(), code: z.string() })),
});
export const envelopeSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    command: commandSchema.nullable(),
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
    configVersion: z
      .string()
      .regex(/^sha256:[a-f0-9]{64}$/)
      .nullable(),
    data: z.unknown(),
    diagnostics: z.array(diagnosticSchema),
  })
  .superRefine((v, c) => {
    if (
      v.ok !== (v.exitCode === 0) ||
      (v.effect === "unknown" &&
        (v.exitCode !== 5 || v.configVersion !== null || v.data !== null)) ||
      (v.exitCode === 130 && v.effect !== "none")
    )
      c.addIssue({ code: "custom", message: "Invalid result state" });
    if (v.data === null) {
      if (v.ok)
        c.addIssue({ code: "custom", message: "Missing successful result" });
      return;
    }
    let schema: z.ZodType;
    switch (v.command) {
      case "inspect":
        schema = inspectSchema;
        break;
      case "check":
        schema = checkSchema;
        break;
      case "plan":
        schema = planSchema;
        break;
      case "content list":
        schema = z.strictObject({ entries: z.array(entrySchema) });
        break;
      case "init":
        schema = z.strictObject({
          configPath: z.string(),
          outputDirectory: z.string(),
          changed: z.literal(true),
        });
        break;
      default:
        schema = z.strictObject({ entry: entrySchema, changed: z.boolean() });
    }
    if (!schema.safeParse(v.data).success)
      c.addIssue({ code: "custom", message: "Invalid command data" });
  });
export type Envelope = z.infer<typeof envelopeSchema>;

// The JSON visitor detects duplicate decoded keys (including escaped spellings).
export function parseJson(bytes: Uint8Array): unknown {
  let input = new TextDecoder("utf-8", { fatal: true })
    .decode(bytes)
    .replace(/^\uFEFF/, "");
  const stack: Set<string>[] = [];
  let invalid = false;
  visit(
    input,
    {
      onObjectBegin: () => {
        stack.push(new Set());
      },
      onObjectProperty: (key) => {
        const set = stack.at(-1)!;
        if (set.has(key)) invalid = true;
        set.add(key);
      },
      onObjectEnd: () => {
        stack.pop();
      },
      onError: () => {
        invalid = true;
      },
    },
    {
      disallowComments: true,
      allowTrailingComma: false,
      allowEmptyContent: false,
    },
  );
  if (invalid) throw new Error("Invalid JSON or duplicate key");
  return JSON.parse(input);
}

export const requestSchema = z
  .strictObject({
    command: commandSchema,
    config: filePath.optional(),
    source: filePath.optional(),
    format: z.enum(["markdown", "obsidian-markdown"]).optional(),
    outDir: filePath.optional(),
    slug: slugSchema.optional(),
    id: idSchema.optional(),
    target: z.string().min(1).optional(),
  })
  .superRefine((r, ctx) => {
    const required =
      r.command === "inspect"
        ? ["source", "format"]
        : r.command === "init"
          ? ["source", "format", "config", "outDir"]
          : r.command === "content add"
            ? ["config", "slug", "target"]
            : r.command === "content remove"
              ? ["config", "target"]
              : ["config"];
    const allowed = new Set([
      ...required,
      "command",
      ...(r.command === "content add" ? ["id"] : []),
    ]);
    for (const key of required)
      if (!(r as Record<string, unknown>)[key])
        ctx.addIssue({
          code: "custom",
          message: "Missing argument",
          path: [key],
        });
    for (const [key, value] of Object.entries(r))
      if (value !== undefined && !allowed.has(key))
        ctx.addIssue({
          code: "custom",
          message: "Unexpected argument",
          path: [key],
        });
    if (
      r.command === "content add" &&
      !sourceSchema.safeParse(r.target).success
    )
      ctx.addIssue({ code: "custom", message: "Invalid source argument" });
    if (r.command === "content remove" && !idSchema.safeParse(r.target).success)
      ctx.addIssue({ code: "custom", message: "Invalid ID argument" });
  });
