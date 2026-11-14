import path from "node:path";
import { createIndex } from "pagefind";
import type { ContentBundle } from "../../../packages/content-contract/src/bundle.js";
import { cancelled, Failure } from "../../../packages/publisher/src/errors.js";
import { contentRenderer, escapeHtml } from "./render.js";

// Only call with a validated bundle and a newly allocated site generation.
export async function buildSearch(
  bundle: ContentBundle,
  site: string,
  signal?: AbortSignal,
) {
  cancelled(signal);
  if (!bundle.documents.length) return;
  const created = await createIndex();
  const index = created.index;
  const check = (errors: string[]) => {
    if (errors.length)
      throw new Failure("SEARCH_BUILD_FAILED", 4, errors.join("\n"));
  };
  try {
    check(created.errors);
    if (!index) throw new Failure("SEARCH_BUILD_FAILED", 4);
    const { render, local } = contentRenderer(bundle);
    const bodies = new Map(bundle.documents.map((d) => [d.id, d.body]));
    for (const document of bundle.manifest.documents) {
      cancelled(signal);
      const body = bodies.get(document.id)!;
      const hasTitle =
        "children" in body &&
        body.children.some((n) => n.type === "heading" && n.depth === 1);
      const response = await index.addHTMLFile({
        url: local(document.route),
        content: `<html lang="zh-CN"><head><title>${escapeHtml(document.title)}</title></head><body><main data-pagefind-body>${hasTitle ? "" : `<h1>${escapeHtml(document.title)}</h1>`}${render(body)}</main></body></html>`,
      });
      check(response.errors);
    }
    cancelled(signal);
    check(
      (await index.writeFiles({ outputPath: path.join(site, "pagefind") }))
        .errors,
    );
    cancelled(signal);
  } finally {
    // Never close the shared service: another build may own a different index.
    await index?.deleteIndex();
  }
}
