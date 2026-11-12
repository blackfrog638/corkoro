import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  configSchema,
  requestSchema,
  envelopeSchema,
  entrySchema,
  routeKey,
  type Config,
  type Command,
  type Envelope,
  type Diagnostic,
} from "../../content-contract/src/index.js";
import { loadConfig, validatePaths, regularSource, hash } from "./files.js";
import { inspect } from "./inspect.js";
import { analyze } from "./planning.js";
import { openTransaction } from "./transaction.js";
import { Failure, failure, diag, cancelled } from "./errors.js";
export { openTransaction } from "./transaction.js";
export { Failure } from "./errors.js";
export type Request = {
  command: Command;
  config?: string;
  source?: string;
  format?: "markdown" | "obsidian-markdown";
  outDir?: string;
  slug?: string;
  id?: string;
  target?: string;
};
const codes = (ds: Diagnostic[]): Envelope["exitCode"] =>
  ds.some((d) => d.code === "CANCELLED")
    ? 130
    : ds.some((d) => d.code === "INTERNAL_ERROR")
      ? 1
      : ds.some((d) => ["IO_ERROR", "INPUT_CHANGED"].includes(d.code))
        ? 4
        : ds.some((d) => d.severity === "error")
          ? 3
          : 0;
const compareDiagnosticValue = (
  a: string | number | null,
  b: string | number | null,
) => (a === b ? 0 : a === null ? -1 : b === null ? 1 : a < b ? -1 : 1);
export async function execute(
  req: Request,
  signal?: AbortSignal,
): Promise<Envelope> {
  const result: Envelope = {
    schemaVersion: 1,
    command: req.command,
    ok: true,
    exitCode: 0,
    effect: "none",
    configVersion: null,
    data: null,
    diagnostics: [],
  };
  let transaction: Awaited<ReturnType<typeof openTransaction>> | undefined;
  try {
    if (!requestSchema.safeParse(req).success)
      throw new Failure("INVALID_ARGUMENT", 2);
    cancelled(signal);
    if (req.command === "inspect") {
      const inspected = await inspect(path.resolve(req.source!), signal);
      result.data = inspected.data;
      result.diagnostics = inspected.diagnostics;
      result.exitCode = codes(result.diagnostics);
    } else {
      let filename = path.resolve(req.config!);
      const write = ["init", "content add", "content remove"].includes(
        req.command,
      );
      if (write) {
        transaction = await openTransaction(filename, signal);
        filename = transaction.target;
        if (transaction.leftovers)
          result.diagnostics.push(diag("CLEANUP_PENDING", "warning"));
      }
      let c: Config, original: Buffer | undefined;
      if (req.command === "init") {
        try {
          await fs.lstat(filename);
          throw new Failure("CONFIG_EXISTS", 4);
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
        }
        const base = path.dirname(filename);
        const rel = (p: string) =>
          path.relative(base, p).split(path.sep).join("/") || ".";
        c = configSchema.parse({
          schemaVersion: 1,
          source: {
            root: rel(path.resolve(req.source!)),
            format: req.format,
            assetRoots: [],
          },
          publication: { entries: [] },
          site: { title: "我的博客", profile: null, pages: [], friends: [] },
          theme: {
            name: "default",
            settings: { colorMode: "system", accentColor: "#3b82f6" },
          },
          output: { directory: rel(path.resolve(base, req.outDir!)) },
        });
        await validatePaths(c, filename);
        result.data = {
          configPath: filename,
          outputDirectory: path.resolve(base, c.output.directory),
          changed: true,
        };
      } else {
        const loaded = await loadConfig(filename);
        c = loaded.config;
        original = loaded.bytes;
        result.configVersion = loaded.version;
        if (req.command === "content list")
          result.data = { entries: c.publication.entries };
        if (req.command === "check" || req.command === "plan") {
          const analysis = await analyze(c, filename, signal);
          result.data =
            req.command === "check" ? analysis.check : analysis.plan;
          result.diagnostics.push(...analysis.diagnostics);
          if (req.command === "plan")
            result.diagnostics.push(diag("BASELINE_NOT_SUPPORTED", "info"));
          result.exitCode = codes(result.diagnostics);
        }
        if (req.command === "content add") {
          const parsed = entrySchema.safeParse({
            source: req.target,
            id: req.id ?? "temporary-id",
            slug: req.slug,
            publish: true,
          });
          if (!parsed.success)
            throw new Failure(
              "INVALID_ARGUMENT",
              2,
              "Invalid article source, ID or slug",
            );
          const root = await fs.realpath(
            path.resolve(path.dirname(filename), c.source.root),
          );
          const target = await regularSource(
            path.resolve(root, req.target!),
            root,
          );
          const targetStat = await fs.stat(target, { bigint: true });
          const configStat = await fs.stat(filename, { bigint: true });
          if (
            targetStat.dev === configStat.dev &&
            targetStat.ino === configStat.ino
          )
            throw new Failure("PATH_OUT_OF_SCOPE", 3);
          const old = c.publication.entries.find(
            (e) => e.source === req.target,
          );
          for (const e of [
            ...c.publication.entries
              .filter((e) => e !== old)
              .map((e) => path.resolve(root, e.source)),
            ...c.site.pages.map((e) =>
              path.resolve(path.dirname(filename), e.source),
            ),
          ]) {
            try {
              const st = await fs.stat(e, { bigint: true });
              if (st.dev === targetStat.dev && st.ino === targetStat.ino)
                throw new Failure(
                  "ENTRY_CONFLICT",
                  3,
                  "Source already registered",
                );
            } catch (e) {
              if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
            }
          }
          if (
            old &&
            (old.slug !== req.slug ||
              (req.id !== undefined && old.id !== req.id))
          )
            throw new Failure("ENTRY_CONFLICT", 3);
          const usedIds = new Set(
            [...c.publication.entries, ...c.site.pages].map((e) => e.id),
          );
          let id = req.id;
          if (!old && !id) {
            for (let n = 0; n < 3; n++) {
              const candidate = randomUUID();
              if (!usedIds.has(candidate)) {
                id = candidate;
                break;
              }
            }
            if (!id) throw new Failure("ID_ALLOCATION_FAILED", 1);
          }
          if (!old && usedIds.has(id!)) throw new Failure("DUPLICATE_ID", 3);
          const routes = new Set(
            [
              "/",
              "/friends/",
              "/search/",
              ...c.publication.entries
                .filter((e) => e !== old)
                .map((e) => `/${e.slug}/`),
              ...c.site.pages.map((e) => e.route),
            ].map(routeKey),
          );
          if (routes.has(routeKey(`/${req.slug}/`)))
            throw new Failure("DUPLICATE_ROUTE", 3);
          const changed = !old?.publish;
          const entry = old ?? {
            source: req.target!,
            id: id!,
            slug: req.slug!,
            publish: true,
          };
          entry.publish = true;
          if (!old) c.publication.entries.push(entry);
          result.data = { entry, changed };
        }
        if (req.command === "content remove") {
          const entry = c.publication.entries.find((e) => e.id === req.target);
          if (!entry) throw new Failure("UNKNOWN_ID", 3);
          const changed = entry.publish;
          entry.publish = false;
          result.data = { entry, changed };
        }
      }
      if (transaction && (result.data as { changed?: boolean })?.changed) {
        if (!configSchema.safeParse(c).success)
          throw new Failure(
            "INVALID_CONFIG",
            2,
            "Candidate configuration is invalid",
          );
        const bytes = Buffer.from(JSON.stringify(c, null, 2) + "\n");
        cancelled(signal);
        const committed = await transaction.commit(
          bytes,
          original ? hash(original) : null,
        );
        result.effect = "committed";
        result.configVersion = committed.version;
        if (committed.cancelledAfterCommit)
          result.diagnostics.push(diag("CANCEL_AFTER_COMMIT", "warning"));
      } else if (req.command !== "check" && req.command !== "plan")
        cancelled(signal);
    }
  } catch (e) {
    const err = failure(e);
    result.exitCode = err.exitCode;
    result.data = null;
    result.diagnostics.push(diag(err.code, "error", err.message));
    if (err.code === "COMMIT_UNKNOWN") {
      result.effect = "unknown";
      result.configVersion = null;
    }
  } finally {
    if (transaction) {
      await transaction.close();
      if (transaction.cleanupPending)
        result.diagnostics.push(diag("CLEANUP_PENDING", "warning"));
    }
  }
  result.ok = result.exitCode === 0;
  result.diagnostics.sort(
    (a, b) =>
      ({ error: 0, warning: 1, info: 2 })[a.severity] -
        { error: 0, warning: 1, info: 2 }[b.severity] ||
      compareDiagnosticValue(a.code, b.code) ||
      compareDiagnosticValue(
        a.location?.path ?? null,
        b.location?.path ?? null,
      ) ||
      compareDiagnosticValue(
        a.location?.pointer ?? null,
        b.location?.pointer ?? null,
      ) ||
      compareDiagnosticValue(
        a.location?.line ?? null,
        b.location?.line ?? null,
      ) ||
      compareDiagnosticValue(
        a.location?.column ?? null,
        b.location?.column ?? null,
      ),
  );
  return envelopeSchema.parse(result);
}
