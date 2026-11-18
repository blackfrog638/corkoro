import path from "node:path";
import { readSite } from "./index.js";
import { readStable, hash } from "../../../packages/publisher/src/files.js";
import { parseBundle } from "../../../packages/publisher/src/bundle.js";
import { cancelled, Failure } from "../../../packages/publisher/src/errors.js";
import { sealDeployment } from "../../../packages/content-contract/src/deployment.js";

export async function captureDeployment(
  outputDirectory: string,
  signal?: AbortSignal,
) {
  cancelled(signal);
  const site = await readSite(outputDirectory);
  const files = [];
  for (const file of site.files) {
    cancelled(signal);
    const bytes = await readStable(path.join(site.siteDirectory, file.path));
    if (hash(bytes) !== file.hash) throw new Failure("SITE_CHANGED", 4);
    files.push({ ...file, base64: bytes.toString("base64") });
  }
  const content = files.find((f) => f.path === "content.bundle.json");
  if (!content)
    throw new Failure(
      "SITE_CHANGED",
      4,
      "Build a site with the current build CLI first",
    );
  const bundle = parseBundle(Buffer.from(content.base64, "base64"));
  if (bundle.buildId !== site.buildId) throw new Failure("SITE_CHANGED", 4);
  cancelled(signal);
  return sealDeployment({
    format: "corkoro-deployment",
    schemaVersion: 1,
    buildId: site.buildId,
    base: bundle.manifest.site.address?.base ?? "/",
    files,
  });
}
