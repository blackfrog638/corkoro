import { captureContent } from "../../../packages/publisher/src/capture.js";
import { buildSite } from "../../../apps/web/src/index.js";
import {
  envelopeSchema,
  type Envelope,
} from "../../../packages/content-contract/src/index.js";
import { failure, diag } from "../../../packages/publisher/src/errors.js";

export async function executeBuild(
  config: string,
  signal?: AbortSignal,
): Promise<Envelope> {
  const result: Envelope = {
    schemaVersion: 1,
    command: "build",
    ok: false,
    exitCode: 0,
    effect: "none",
    configVersion: null,
    data: null,
    diagnostics: [],
  };
  try {
    const captured = await captureContent(config, signal);
    result.configVersion = captured.configVersion;
    const site = await buildSite(
      captured.bundle,
      captured.outputDirectory,
      signal,
    );
    result.exitCode = site.exitCode;
    result.effect = site.effect;
    result.diagnostics = [...captured.diagnostics, ...site.diagnostics];
    if (site.effect === "unknown") result.configVersion = null;
    else
      result.data = {
        buildId: captured.bundle.buildId,
        outputDirectory: captured.outputDirectory,
        siteDirectory: site.siteDirectory,
        retainedDirectory: site.retainedDirectory,
      };
  } catch (e) {
    const error = failure(e);
    result.exitCode = error.exitCode;
    result.diagnostics.push(diag(error.code, "error", error.message));
  }
  result.ok = result.exitCode === 0;
  return envelopeSchema.parse(result);
}
