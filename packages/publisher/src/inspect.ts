import fs from "node:fs/promises";
import path from "node:path";
import { parseDocument } from "yaml";
import {
  excluded,
  inspectSchema,
  type Diagnostic,
} from "../../content-contract/src/index.js";
import { cancelled, diag, failure, Failure } from "./errors.js";
import { readStable, forbidden } from "./files.js";
export async function inspect(source: string, signal?: AbortSignal) {
  const root = await fs.realpath(source);
  if (forbidden(root) || !(await fs.stat(root)).isDirectory())
    throw new Failure("PATH_OUT_OF_SCOPE", 3);
  const data = inspectSchema.parse({
    inventory: [],
    complete: true,
    skipped: [],
    unexamined: [],
  });
  const diagnostics: Diagnostic[] = [];
  async function walk(dir: string) {
    for (const e of await fs.readdir(dir, { withFileTypes: true })) {
      cancelled(signal);
      const full = path.join(dir, e.name),
        relative = path.relative(root, full).split(path.sep).join("/");
      if (excluded.has(e.name.toLowerCase())) {
        data.skipped.push({
          source: relative,
          reason:
            e.name.toLowerCase() === ".corkoro-state"
              ? "transaction"
              : "system",
        });
        continue;
      }
      if (e.isSymbolicLink()) {
        data.skipped.push({ source: relative, reason: "symlink" });
        continue;
      }
      try {
        if (e.isDirectory()) {
          await walk(full);
          continue;
        }
        if (!e.isFile()) throw new Failure("UNSUPPORTED_ASSET", 3);
        const bytes = await readStable(full);
        const item: {
          source: string;
          kind: "markdown" | "asset" | "other";
          publishHint: boolean | null;
          syntax: (
            | "markdown-link"
            | "markdown-image"
            | "wikilink"
            | "embed"
            | "other"
          )[];
        } = {
          source: relative,
          kind: e.name.endsWith(".md")
            ? "markdown"
            : /\.(png|jpe?g|gif|svg|webp|avif)$/i.test(e.name)
              ? "asset"
              : "other",
          publishHint: null,
          syntax: [],
        };
        if (item.kind === "markdown") {
          const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
          let body = text;
          if (/^---\r?\n/.test(text)) {
            const match = text.match(
              /^---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)(?:\r?\n|$)/,
            );
            if (!match)
              throw new Failure(
                "UNSUPPORTED_SYNTAX",
                3,
                "Unclosed frontmatter",
              );
            const doc = parseDocument(match[1]!, { uniqueKeys: true });
            if (doc.errors.length)
              throw new Failure(
                "UNSUPPORTED_SYNTAX",
                3,
                "Invalid YAML frontmatter",
              );
            const value = doc.get("publish");
            if (typeof value === "boolean") item.publishHint = value;
            body = text.slice(match[0].length);
          }
          if (/!?\[[^\]]*\]\([^)]*\)/.test(body))
            item.syntax.push("markdown-link");
          if (/!\[[^\]]*\]\([^)]*\)/.test(body))
            item.syntax.push("markdown-image");
          if (/\[\[/.test(body)) item.syntax.push("wikilink");
          if (/!\[\[/.test(body)) item.syntax.push("embed");
          item.syntax.push("other"); // Inspection is a lexical inventory, not a compatibility claim.
        }
        data.inventory.push(item);
      } catch (e) {
        const err = failure(e);
        if (err.exitCode === 130) throw err;
        data.unexamined.push({ source: relative, code: err.code });
        diagnostics.push(diag(err.code));
      }
    }
  }
  try {
    await walk(root);
  } catch (e) {
    const err = failure(e);
    data.unexamined.push({ source: ".", code: err.code });
    diagnostics.push(diag(err.code));
  }
  const compare = (a: { source: string }, b: { source: string }) => {
    const x = Array.from(a.source),
      y = Array.from(b.source);
    for (let i = 0; i < Math.min(x.length, y.length); i++) {
      const d = x[i]!.codePointAt(0)! - y[i]!.codePointAt(0)!;
      if (d) return d;
    }
    return x.length - y.length;
  };
  data.inventory.sort(compare);
  data.skipped.sort(compare);
  data.unexamined.sort(compare);
  data.complete = data.unexamined.length === 0;
  return { data, diagnostics };
}
