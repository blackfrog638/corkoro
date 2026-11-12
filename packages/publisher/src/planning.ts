import fs from "node:fs/promises";
import path from "node:path";
import type {
  Config,
  CheckData,
  PlanData,
  Diagnostic,
  Reason,
} from "../../content-contract/src/index.js";
import {
  canonical,
  forbidden,
  inside,
  readStable,
  regularSource,
  validatePaths,
} from "./files.js";
import { cancelled, diag, failure, Failure } from "./errors.js";
import { parseMarkdown, type Reference } from "./markdown.js";
import { validateAsset } from "./assets.js";

const relative = (root: string, p: string) =>
  path.relative(root, p).split(path.sep).join("/");
const identity = async (p: string) => {
  const s = await fs.stat(p, { bigint: true });
  return `${s.dev}:${s.ino}`;
};
const reason = (
  code: Reason["code"],
  field: string | null,
  fromId: string | null = null,
): Reason => ({ code, field, fromId });
export type CapturedDocument = {
  id: string;
  source: string;
  route: string;
  bytes: Buffer;
  parsed: ReturnType<typeof parseMarkdown>;
  links: {
    reference: Reference;
    targetId: string | null;
    asset: { assetRoot: number; path: string } | null;
    url: string | null;
  }[];
};

export async function analyze(
  c: Config,
  configPath: string,
  signal?: AbortSignal,
) {
  const base = path.dirname(configPath),
    lexicalRoot = path.resolve(base, c.source.root);
  const plan: PlanData = {
    articles: c.publication.entries.flatMap((e, i) =>
      e.publish
        ? [
            {
              id: e.id,
              source: e.source,
              slug: e.slug,
              reason: reason("SELECTED_ARTICLE", `/publication/entries/${i}`),
            },
          ]
        : [],
    ),
    pages: c.site.pages.flatMap((p, i) =>
      p.publish
        ? [
            {
              id: p.id,
              source: relative(lexicalRoot, path.resolve(base, p.source)),
              route: p.route,
              reason: reason("SELECTED_PAGE", `/site/pages/${i}`),
            },
          ]
        : [],
    ),
    profile: c.site.profile
      ? {
          value: structuredClone(c.site.profile),
          reason: reason("EXPLICIT_PROFILE", "/site/profile"),
        }
      : null,
    friends: c.site.friends.map((value, i) => ({
      value: structuredClone(value),
      reason: reason("EXPLICIT_FRIEND", `/site/friends/${i}`),
    })),
    assets: [],
    blockedReferences: [],
    changes: null,
    complete: false,
    buildable: false,
  };
  const check: CheckData = {
    selectedCount: plan.articles.length,
    pageCount: plan.pages.length,
    hasProfile: plan.profile !== null,
    friendCount: plan.friends.length,
    passedChecks: ["config", "selection", "site", "theme"],
    failedChecks: [],
    unperformedChecks: ["paths", "references"],
    complete: false,
    buildable: false,
  };
  const diagnostics: Diagnostic[] = [];
  const documents = new Map<string, CapturedDocument>();
  const assets = new Map<string, Buffer>();
  const nonempty = !!(
    plan.articles.length ||
    plan.pages.length ||
    plan.profile ||
    plan.friends.length
  );
  if (!nonempty) diagnostics.push(diag("EMPTY_SELECTION", "warning"));
  let stage: "paths" | "references" = "paths";
  try {
    await validatePaths(c, configPath);
    cancelled(signal);
    check.passedChecks.push("paths");
    check.unperformedChecks = ["references"];
    stage = "references";
    const root = await fs.realpath(lexicalRoot);
    for (const page of plan.pages) {
      const input = c.site.pages.find((p) => p.id === page.id)!;
      page.source = relative(
        root,
        await regularSource(path.resolve(base, input.source), root),
      );
    }
    const assetRoots = await Promise.all(
      c.source.assetRoots.map((p) => fs.realpath(path.resolve(base, p))),
    );
    const configIdentity = await identity(configPath);
    const selected = new Map<string, string>();
    const notePaths = new Map<string, string>();
    for (const e of [
      ...plan.articles.map((a) => ({
        ...a,
        route: `/${encodeURIComponent(a.slug)}/`,
      })),
      ...plan.pages,
    ]) {
      cancelled(signal);
      const p = await regularSource(path.resolve(root, e.source), root);
      selected.set(await identity(p), e.id);
      notePaths.set(e.id, p);
      const bytes = await readStable(p);
      let input: string;
      try {
        input = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        diagnostics.push({
          ...diag(
            "UNSUPPORTED_SYNTAX",
            "error",
            "Source is not UTF-8 Markdown",
          ),
          location: {
            kind: "source",
            path: e.source,
            assetRoot: null,
            pointer: null,
            line: null,
            column: null,
          },
        });
        continue;
      }
      documents.set(e.id, {
        id: e.id,
        source: e.source,
        route: e.route,
        bytes,
        parsed: parseMarkdown(input, c.source.format),
        links: [],
      });
    }

    let index: string[] | undefined;
    async function fileIndex() {
      if (index) return index;
      const found = new Set<string>();
      const visited = new Set<string>();
      async function walk(dir: string) {
        cancelled(signal);
        if (visited.has(dir)) return;
        visited.add(dir);
        for (const e of await fs.readdir(dir, { withFileTypes: true })) {
          const p = path.join(dir, e.name);
          if (forbidden(p) || e.isSymbolicLink()) continue;
          if (e.isDirectory()) await walk(p);
          else if (e.isFile()) found.add(p);
        }
      }
      for (const r of [root, ...assetRoots]) await walk(r);
      index = [...found].sort();
      return index;
    }
    async function locate(ref: Reference, current: string) {
      let target: string;
      try {
        target = ref.wiki ? ref.target : decodeURIComponent(ref.target);
      } catch {
        throw new Failure("UNSUPPORTED_SYNTAX", 3, "Invalid URL encoding");
      }
      if (ref.unsupported) throw new Failure("UNSUPPORTED_SYNTAX", 3);
      if (/^(?:https?:\/\/|mailto:|\/\/)/i.test(target)) {
        if (ref.wiki || (ref.embed && /^mailto:/i.test(target)))
          throw new Failure("UNSUPPORTED_SYNTAX", 3);
        try {
          new URL(target.startsWith("//") ? `https:${target}` : target);
        } catch {
          throw new Failure("UNSUPPORTED_SYNTAX", 3);
        }
        return { external: ref.target };
      }
      if (
        /^[a-z][a-z0-9+.-]*:/i.test(target) ||
        target.includes("\\") ||
        /[\x00-\x1f]/.test(target) ||
        path.isAbsolute(target)
      )
        throw new Failure("PATH_OUT_OF_SCOPE", 3);
      if (!target || /[#?]/.test(target))
        throw new Failure(
          "UNSUPPORTED_SYNTAX",
          3,
          "Fragments and local query strings are not supported yet",
        );
      if (!path.extname(target)) target += ".md";
      let p: string;
      if (ref.wiki && !target.includes("/")) {
        const matches = (await fileIndex()).filter(
          (p) => path.basename(p) === target,
        );
        if (matches.length > 1) throw new Failure("AMBIGUOUS_TARGET", 3);
        if (!matches.length) throw new Failure("MISSING_TARGET", 3);
        p = matches[0]!;
      } else {
        p = path.resolve(
          ref.wiki && !target.startsWith(".") ? root : path.dirname(current),
          target,
        );
      }
      const real = await canonical(p);
      if (
        forbidden(p) ||
        forbidden(real) ||
        ![root, ...assetRoots].some((r) => inside(r, real))
      )
        throw new Failure("PATH_OUT_OF_SCOPE", 3);
      return { local: p };
    }
    async function captureAsset(p: string, why: Reason) {
      const real = await canonical(p);
      const assetRoot = assetRoots.findIndex((r) => inside(r, real));
      if (assetRoot < 0 || forbidden(p) || forbidden(real))
        throw new Failure("PATH_OUT_OF_SCOPE", 3);
      await regularSource(p, assetRoots[assetRoot]!);
      if ((await identity(real)) === configIdentity)
        throw new Failure("PATH_OUT_OF_SCOPE", 3);
      const item = { assetRoot, path: relative(assetRoots[assetRoot]!, real) };
      const key = `${assetRoot}:${item.path}`;
      if (!assets.has(key)) {
        const bytes = await readStable(real);
        validateAsset(real, bytes);
        assets.set(key, bytes);
        plan.assets.push({ ...item, reasons: [] });
      }
      const report = plan.assets.find(
        (a) => a.assetRoot === assetRoot && a.path === item.path,
      )!;
      if (
        !report.reasons.some(
          (r) => r.fromId === why.fromId && r.field === why.field,
        )
      )
        report.reasons.push(why);
      return item;
    }
    for (const doc of documents.values()) {
      for (const ref of doc.parsed.references) {
        cancelled(signal);
        try {
          const resolved = await locate(ref, notePaths.get(doc.id)!);
          if (resolved.external !== undefined) {
            doc.links.push({
              reference: ref,
              targetId: null,
              asset: null,
              url: resolved.external,
            });
          } else if (path.extname(resolved.local!).toLowerCase() === ".md") {
            const p = await regularSource(resolved.local!, root);
            const key = await identity(p);
            if (key === configIdentity)
              throw new Failure("PATH_OUT_OF_SCOPE", 3);
            const id = selected.get(key);
            if (!id)
              throw new Failure(
                ref.embed ? "UNPUBLISHED_EMBED" : "UNPUBLISHED_TARGET",
                3,
              );
            if (ref.embed)
              throw new Failure(
                "UNSUPPORTED_SYNTAX",
                3,
                "Note transclusion is not supported",
              );
            doc.links.push({
              reference: ref,
              targetId: id,
              asset: null,
              url: documents.get(id)?.route ?? null,
            });
          } else {
            const asset = await captureAsset(
              resolved.local!,
              reason("REFERENCED_ASSET", null, doc.id),
            );
            doc.links.push({
              reference: ref,
              targetId: null,
              asset,
              url: null,
            });
          }
        } catch (e) {
          const err = failure(e, "MISSING_TARGET");
          if (err.exitCode !== 3) throw err;
          plan.blockedReferences.push({
            fromId: doc.id,
            target: ref.target,
            code: err.code,
            line: ref.line,
            column: ref.column,
          });
          diagnostics.push({
            ...diag(err.code),
            location: {
              kind: "source",
              path: doc.source,
              assetRoot: null,
              pointer: null,
              line: ref.line,
              column: ref.column,
            },
          });
        }
      }
    }
    if (c.site.profile?.avatar) {
      cancelled(signal);
      try {
        await captureAsset(
          path.resolve(base, c.site.profile.avatar),
          reason("REFERENCED_ASSET", "/site/profile/avatar"),
        );
      } catch (e) {
        const err = failure(e, "MISSING_TARGET");
        if (err.exitCode !== 3) throw err;
        diagnostics.push({
          ...diag(err.code),
          location: {
            kind: "config",
            path: configPath,
            assetRoot: null,
            pointer: "/site/profile/avatar",
            line: null,
            column: null,
          },
        });
      }
    }
    cancelled(signal);
    check.unperformedChecks = [];
    (diagnostics.some((d) => d.severity === "error")
      ? check.failedChecks
      : check.passedChecks
    ).push("references");
    check.complete = plan.complete = true;
    check.buildable = plan.buildable = nonempty && !check.failedChecks.length;
  } catch (e) {
    const err = failure(e);
    diagnostics.push(diag(err.code, "error", err.message));
    if (stage === "paths" && err.exitCode === 3) {
      check.failedChecks.push("paths");
      check.unperformedChecks = ["references"];
    }
  }
  plan.assets.sort(
    (a, b) =>
      a.assetRoot - b.assetRoot ||
      (a.path < b.path ? -1 : a.path > b.path ? 1 : 0),
  );
  return { plan, check, diagnostics, documents, assets };
}
