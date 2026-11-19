import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import {
  sitePointerSchema,
  siteResultSchema,
  type SitePointer,
  type SiteResult,
} from "../../../packages/content-contract/src/site-output.js";
import { parseJson } from "../../../packages/content-contract/src/index.js";
import {
  readContentBundle,
  parseBundle,
} from "../../../packages/publisher/src/bundle.js";
import type { ContentBundle } from "../../../packages/content-contract/src/bundle.js";
import {
  canonical,
  containsPath,
  readStable,
  hash,
} from "../../../packages/publisher/src/files.js";
import { openTransaction } from "../../../packages/publisher/src/transaction.js";
import {
  Failure,
  cancelled,
  failure,
  diag,
  compareDiagnostics,
} from "../../../packages/publisher/src/errors.js";
import { defaultPages } from "./theme.js";
import { buildSearch } from "./search.js";

const require = createRequire(import.meta.url);
const astroPackage = path.dirname(require.resolve("astro/package.json"));
const astroMetadata = require("astro/package.json") as {
  version: string;
  bin: { astro: string };
};

async function inventory(
  directory: string,
  prefix = "",
): Promise<SitePointer["files"]> {
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw new Failure("UNSAFE_SITE_OUTPUT", 4);
  const files: SitePointer["files"] = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name),
      relative = prefix + entry.name;
    if (entry.isSymbolicLink()) throw new Failure("UNSAFE_SITE_OUTPUT", 4);
    if (entry.isDirectory())
      files.push(...(await inventory(filename, relative + "/")));
    else {
      const s = await fs.lstat(filename);
      if (!s.isFile() || s.nlink !== 1)
        throw new Failure("UNSAFE_SITE_OUTPUT", 4);
      files.push({ path: relative, hash: hash(await readStable(filename)) });
    }
  }
  return files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

async function resolveSite(output: string, bytes: Buffer) {
  const pointer = sitePointerSchema.parse(parseJson(bytes));
  const generation = path.join(output, pointer.generation);
  const stat = await fs.lstat(generation);
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw new Failure("UNSAFE_SITE_OUTPUT", 4);
  const siteDirectory = path.join(generation, "site");
  if (
    JSON.stringify(await inventory(siteDirectory)) !==
    JSON.stringify(pointer.files)
  )
    throw new Failure("SITE_CHANGED", 4);
  return {
    ...pointer,
    siteDirectory,
    projectDirectory: path.join(generation, "project"),
  };
}

export async function readSite(outputDirectory: string) {
  const output = await canonical(path.resolve(outputDirectory));
  return resolveSite(
    output,
    await readStable(path.join(output, "site.current.json")),
  );
}

async function runAstro(project: string, signal?: AbortSignal) {
  cancelled(signal);
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        path.join(astroPackage, astroMetadata.bin.astro),
        "build",
        "--root",
        project,
        "--config",
        "astro.config.mjs",
        "--silent",
      ],
      {
        cwd: project,
        windowsHide: true,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, ASTRO_TELEMETRY_DISABLED: "1", CI: "true" },
      },
    );
    let log = "";
    const capture = (b: Buffer) => {
      log = (log + b.toString()).slice(-16000);
    };
    child.stdout.on("data", capture);
    child.stderr.on("data", capture);
    const stop = () => {
      child.kill();
    };
    signal?.addEventListener("abort", stop, { once: true });
    if (signal?.aborted) stop();
    child.on("error", reject);
    child.on("close", (code) => {
      signal?.removeEventListener("abort", stop);
      if (signal?.aborted) reject(new Failure("CANCELLED", 130));
      else if (code === 0) resolve();
      else
        reject(
          new Failure("SITE_BUILD_FAILED", 4, log || "Astro build failed"),
        );
    });
  });
}

export async function buildSite(
  bundlePath: string | ContentBundle,
  outputDirectory: string,
  signal?: AbortSignal,
): Promise<SiteResult> {
  const result: SiteResult = {
    ok: false,
    exitCode: 0,
    effect: "none",
    siteDirectory: null,
    retainedDirectory: null,
    diagnostics: [],
  };
  let tx: Awaited<ReturnType<typeof openTransaction>> | undefined;
  try {
    cancelled(signal);
    if (
      !bundlePath ||
      (typeof bundlePath === "string" && !bundlePath.trim()) ||
      !outputDirectory?.trim()
    )
      throw new Failure("INVALID_ARGUMENT", 2);
    // Clone and validate before the first await: callers cannot mutate this build's snapshot.
    const captured =
      typeof bundlePath === "string"
        ? null
        : parseBundle(Buffer.from(JSON.stringify(bundlePath)));
    const input =
      typeof bundlePath === "string"
        ? await canonical(path.resolve(bundlePath))
        : null;
    const output = await canonical(path.resolve(outputDirectory));
    if (input && (await containsPath(output, input)))
      throw new Failure("OUTPUT_OVERLAP", 3);
    const bundle = captured ?? (await readContentBundle(input!));
    let pages;
    try {
      pages = defaultPages(bundle);
    } catch {
      throw new Failure("SITE_ROUTE_UNSUPPORTED", 3);
    }
    tx = await openTransaction(path.join(output, "site.current.json"), signal);
    if (tx.leftovers)
      result.diagnostics.push(diag("CLEANUP_PENDING", "warning"));
    let original: Buffer | undefined;
    try {
      original = await readStable(tx.target);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    if (original) {
      try {
        await resolveSite(output, original);
      } catch {
        throw new Failure("OUTPUT_NOT_OWNED", 4);
      }
    }
    const generation = `corkoro-site-${randomUUID()}`,
      directory = path.join(output, generation);
    await fs.mkdir(directory);
    result.retainedDirectory = directory;
    const project = path.join(directory, "project"),
      site = path.join(directory, "site");
    await fs.mkdir(path.join(project, "src/pages"), { recursive: true });
    await fs.mkdir(path.join(project, "public/assets"), { recursive: true });
    await fs.mkdir(path.join(project, "node_modules"));
    await fs.symlink(
      astroPackage,
      path.join(project, "node_modules/astro"),
      "junction",
    );
    await fs.writeFile(
      path.join(project, "package.json"),
      JSON.stringify({
        private: true,
        type: "module",
        scripts: { build: "astro build" },
        dependencies: { astro: astroMetadata.version },
      }),
    );
    const config = {
      output: "static",
      outDir: "../site",
      base: bundle.manifest.site.address?.base ?? "/",
      ...(bundle.manifest.site.address
        ? { site: bundle.manifest.site.address.origin }
        : {}),
      trailingSlash: "always",
      build: { format: "directory" },
      vite: { logLevel: "error" },
    };
    await fs.writeFile(
      path.join(project, "astro.config.mjs"),
      "export default " + JSON.stringify(config) + ";\n",
    );
    await fs.writeFile(
      path.join(project, "src/pages.json"),
      JSON.stringify(pages),
    );
    await fs.writeFile(
      path.join(project, "src/pages/[...slug].astro"),
      `---\nimport pages from '../pages.json';\nexport function getStaticPaths() { return pages.map(page => ({ params: { slug: page.slug }, props: { html: page.html } })); }\nconst { html } = Astro.props;\n---\n<Fragment set:html={html} />\n`,
    );
    for (const asset of bundle.assets)
      await fs.writeFile(
        path.join(project, "public/assets", asset.id),
        Buffer.from(asset.base64, "base64"),
        { flag: "wx" },
      );
    await runAstro(project, signal);
    await buildSearch(bundle, site, signal);
    await fs.writeFile(
      path.join(site, "content.bundle.json"),
      JSON.stringify(bundle) + "\n",
      { flag: "wx" },
    );
    cancelled(signal);
    const pointer = sitePointerSchema.parse({
      format: "corkoro-site",
      schemaVersion: 1,
      generation,
      buildId: bundle.buildId,
      files: await inventory(site),
    });
    const committed = await tx.commit(
      Buffer.from(JSON.stringify(pointer) + "\n"),
      original ? hash(original) : null,
    );
    result.effect = "committed";
    result.siteDirectory = site;
    if (committed.cancelledAfterCommit)
      result.diagnostics.push(diag("CANCEL_AFTER_COMMIT", "warning"));
  } catch (e) {
    const err = failure(e);
    const code =
      (
        {
          CONFIG_BUSY: "OUTPUT_BUSY",
          CONFIG_CHANGED: "OUTPUT_CHANGED",
          CONFIG_EXISTS: "OUTPUT_CHANGED",
        } as Record<string, string>
      )[err.code] ?? err.code;
    result.exitCode = err.exitCode;
    result.diagnostics.push(diag(code, "error", err.message));
    if (err.code === "COMMIT_UNKNOWN") result.effect = "unknown";
  } finally {
    if (tx) {
      await tx.close();
      if (tx.cleanupPending)
        result.diagnostics.push(diag("CLEANUP_PENDING", "warning"));
    }
  }
  result.ok = result.exitCode === 0;
  result.diagnostics.sort(compareDiagnostics);
  return siteResultSchema.parse(result);
}
