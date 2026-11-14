import path from "node:path";
import { canonical, loadConfig, validatePaths } from "./files.js";
import { analyze } from "./planning.js";
import { createContentBundle } from "./content.js";
import { cancelled, diagnosticExitCode, Failure } from "./errors.js";

/** Capture a fresh authorized snapshot without writing an intermediate bundle. */
export async function captureContent(configPath: string, signal?: AbortSignal) {
  cancelled(signal);
  if (typeof configPath !== "string" || !configPath.trim())
    throw new Failure("INVALID_ARGUMENT", 2);
  const filename = path.resolve(configPath);
  const { config, version } = await loadConfig(filename);
  await validatePaths(config, filename);
  const outputDirectory = await canonical(
    path.resolve(path.dirname(filename), config.output.directory),
  );
  const analysis = await analyze(config, filename, signal);
  cancelled(signal);
  if (!analysis.plan.buildable) {
    const errors = analysis.diagnostics.filter((d) => d.severity === "error");
    if (!errors.length) throw new Failure("EMPTY_SELECTION", 3);
    throw new Failure(
      errors[0]!.code,
      diagnosticExitCode(analysis.diagnostics),
      errors.map((d) => d.message).join("\n"),
    );
  }
  return {
    bundle: createContentBundle(config, analysis),
    outputDirectory,
    configVersion: version,
    diagnostics: analysis.diagnostics,
  };
}
