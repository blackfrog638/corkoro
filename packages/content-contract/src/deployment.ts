import { createHash } from "node:crypto";
import { z } from "zod";
import { sitePointerSchema } from "./site-output.js";
import { siteAddressSchema } from "./site.js";
import { parseJson } from "./index.js";
const hash = (bytes: Uint8Array | string) =>
  "sha256:" + createHash("sha256").update(bytes).digest("hex");
const payloadSchema = z
  .strictObject({
    format: z.literal("corkoro-deployment"),
    schemaVersion: z.literal(1),
    buildId: sitePointerSchema.shape.buildId,
    base: siteAddressSchema.shape.base,
    files: z
      .array(
        sitePointerSchema.shape.files.element.extend({ base64: z.string() }),
      )
      .min(1),
  })
  .superRefine((v, ctx) => {
    const names = new Set<string>();
    for (const f of v.files) {
      const bytes = Buffer.from(f.base64, "base64");
      if (
        bytes.toString("base64") !== f.base64 ||
        hash(bytes) !== f.hash ||
        names.has(f.path.toLowerCase())
      )
        ctx.addIssue({ code: "custom", message: "Invalid deployment file" });
      names.add(f.path.toLowerCase());
    }
    for (const name of names) {
      const segments = name.split("/");
      for (let i = 1; i < segments.length; i++) {
        if (names.has(segments.slice(0, i).join("/")))
          ctx.addIssue({
            code: "custom",
            message: "File conflicts with parent directory",
          });
      }
    }
    if (!v.files.some((f) => f.path === "index.html"))
      ctx.addIssue({ code: "custom", message: "Missing index.html" });
  });
export function sealDeployment(input: unknown) {
  const payload = payloadSchema.parse(input);
  payload.files.sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  );
  return { ...payload, deploymentId: hash(JSON.stringify(payload)) };
}
export type DeploymentSnapshot = ReturnType<typeof sealDeployment>;
export function parseDeployment(bytes: Uint8Array): DeploymentSnapshot {
  const raw = z
    .strictObject({
      ...payloadSchema.shape,
      deploymentId: sitePointerSchema.shape.buildId,
    })
    .parse(parseJson(Buffer.from(bytes)));
  const { deploymentId, ...payload } = raw;
  const verified = sealDeployment(payload);
  if (verified.deploymentId !== deploymentId)
    throw new Error("Deployment digest mismatch");
  return verified;
}
