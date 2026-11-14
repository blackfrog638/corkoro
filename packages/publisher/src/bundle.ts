import path from "node:path";
import { parseJson } from "../../content-contract/src/index.js";
import {
  bundleSchema,
  bundleResultSchema,
  type ContentBundle,
  type BundleResult,
} from "../../content-contract/src/bundle.js";
import {
  canonical,
  hash,
  loadConfig,
  readStable,
  validatePaths,
} from "./files.js";
import { analyze } from "./planning.js";
import { createContentBundle } from "./content.js";
import { openTransaction } from "./transaction.js";
import { validateAsset } from "./assets.js";
import {
  cancelled,
  diag,
  failure,
  Failure,
  diagnosticExitCode,
  compareDiagnostics,
} from "./errors.js";

export function parseBundle(bytes: Buffer): ContentBundle {
  try {
    const bundle = bundleSchema.parse(parseJson(bytes));
    for (const asset of bundle.assets)
      validateAsset(asset.id, Buffer.from(asset.base64, "base64"));
    return bundle;
  } catch {
    throw new Failure("INVALID_BUNDLE", 2);
  }
}
export async function readContentBundle(
  filename: string,
): Promise<ContentBundle> {
  return parseBundle(await readStable(path.resolve(filename)));
}
const outputError = (e: unknown) => {
  const err = failure(e);
  const code = (
    {
      CONFIG_BUSY: "OUTPUT_BUSY",
      CONFIG_CHANGED: "OUTPUT_CHANGED",
      CONFIG_EXISTS: "OUTPUT_CHANGED",
    } as Record<string, string>
  )[err.code];
  return code ? new Failure(code, err.exitCode) : err;
};

export async function buildContentBundle(
  configPath: string,
  signal?: AbortSignal,
): Promise<BundleResult> {
  const result: BundleResult = {
    ok: false,
    exitCode: 0,
    effect: "none",
    bundlePath: null,
    buildId: null,
    diagnostics: [],
  };
  let tx: Awaited<ReturnType<typeof openTransaction>> | undefined;
  try {
    cancelled(signal);
    if (typeof configPath !== "string" || !configPath.trim())
      throw new Failure("INVALID_ARGUMENT", 2);
    const filename = path.resolve(configPath);
    const { config } = await loadConfig(filename);
    await validatePaths(config, filename);
    const output = await canonical(
      path.resolve(path.dirname(filename), config.output.directory),
    );
    result.bundlePath = path.join(output, "content.bundle.json");
    tx = await openTransaction(result.bundlePath, signal);
    if (tx.leftovers)
      result.diagnostics.push(diag("CLEANUP_PENDING", "warning"));
    let previous: ContentBundle | undefined, original: Buffer | undefined;
    try {
      original = await readStable(tx.target);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    if (original) {
      try {
        previous = parseBundle(original);
      } catch {
        throw new Failure(
          "OUTPUT_NOT_OWNED",
          4,
          "Existing target is not a valid Corkoro content bundle",
        );
      }
    }
    const analysis = await analyze(config, filename, signal);
    result.diagnostics.push(...analysis.diagnostics);
    if (!analysis.plan.buildable) {
      const errors = result.diagnostics.filter((d) => d.severity === "error");
      if (!errors.length) {
        result.diagnostics = result.diagnostics.filter(
          (d) => d.code !== "EMPTY_SELECTION",
        );
        throw new Failure("EMPTY_SELECTION", 3);
      }
      result.exitCode = diagnosticExitCode(result.diagnostics);
    } else {
      const bundle = createContentBundle(config, analysis);
      cancelled(signal);
      if (previous?.buildId === bundle.buildId) result.buildId = bundle.buildId;
      else {
        const committed = await tx.commit(
          Buffer.from(JSON.stringify(bundle) + "\n"),
          original ? hash(original) : null,
        );
        result.effect = "committed";
        result.buildId = bundle.buildId;
        if (committed.cancelledAfterCommit)
          result.diagnostics.push(diag("CANCEL_AFTER_COMMIT", "warning"));
      }
    }
  } catch (e) {
    const err = outputError(e);
    result.exitCode = err.exitCode;
    result.diagnostics.push(diag(err.code, "error", err.message));
    if (err.code === "COMMIT_UNKNOWN") {
      result.effect = "unknown";
      result.buildId = null;
    }
  } finally {
    if (tx) {
      await tx.close();
      if (tx.cleanupPending)
        result.diagnostics.push(diag("CLEANUP_PENDING", "warning"));
    }
  }
  result.ok = result.exitCode === 0;
  result.diagnostics.sort(compareDiagnostics);
  return bundleResultSchema.parse(result);
}
