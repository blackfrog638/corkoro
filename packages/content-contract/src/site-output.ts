import { z } from "zod";
import { diagnosticSchema } from "./index.js";

const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
export const sitePointerSchema = z
  .strictObject({
    format: z.literal("corkoro-site"),
    schemaVersion: z.literal(1),
    generation: z.string().regex(/^corkoro-site-[a-f0-9-]{36}$/),
    buildId: digest,
    files: z
      .array(
        z.strictObject({
          path: z
            .string()
            .refine(
              (p) =>
                p.length > 0 &&
                !/[\\:\x00-\x1f]/.test(p) &&
                p.split("/").every((s) => s && s !== "." && s !== ".."),
            ),
          hash: digest,
        }),
      )
      .min(1),
  })
  .superRefine((p, ctx) => {
    if (
      !p.files.some((f) => f.path === "index.html") ||
      new Set(p.files.map((f) => f.path.toLowerCase())).size !== p.files.length
    )
      ctx.addIssue({ code: "custom", message: "Invalid site inventory" });
  });
export type SitePointer = z.infer<typeof sitePointerSchema>;
export const siteResultSchema = z
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
    siteDirectory: z.string().nullable(),
    retainedDirectory: z.string().nullable(),
    diagnostics: z.array(diagnosticSchema),
  })
  .superRefine((r, ctx) => {
    if (
      r.ok !== (r.exitCode === 0) ||
      (r.ok && (!r.siteDirectory || r.effect !== "committed")) ||
      (r.effect === "unknown" &&
        (r.exitCode !== 5 || r.siteDirectory !== null)) ||
      (r.exitCode === 130 && r.effect !== "none")
    )
      ctx.addIssue({ code: "custom", message: "Invalid site result" });
  });
export type SiteResult = z.infer<typeof siteResultSchema>;
