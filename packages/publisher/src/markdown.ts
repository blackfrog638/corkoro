import { fromMarkdown } from "mdast-util-from-markdown";
import { frontmatter } from "micromark-extension-frontmatter";
import { frontmatterFromMarkdown } from "mdast-util-frontmatter";
import type { Root } from "mdast";

export type Reference = {
  target: string;
  embed: boolean;
  wiki: boolean;
  line: number;
  column: number;
  start: number;
  end: number;
  unsupported?: boolean;
};
type Node = {
  type: string;
  url?: string;
  identifier?: string;
  lang?: string | null;
  children?: Node[];
  position?: {
    start: { offset?: number; line: number; column: number };
    end: { offset?: number };
  };
};

export function parseMarkdown(
  input: string,
  format: "markdown" | "obsidian-markdown",
): { tree: Root; references: Reference[] } {
  const tree = fromMarkdown(input, {
    extensions: [frontmatter(["yaml", "toml"])],
    mdastExtensions: [frontmatterFromMarkdown(["yaml", "toml"])],
  });
  const references: Reference[] = [];
  const protectedRanges: [number, number][] = [];
  const definitions = new Map<string, string>();
  const walk = (n: Node, visit: (n: Node) => void) => {
    visit(n);
    for (const child of n.children ?? []) walk(child, visit);
  };
  walk(tree, (n) => {
    if (n.type === "definition" && !definitions.has(n.identifier!))
      definitions.set(n.identifier!, n.url!);
  });
  const add = (
    n: Node,
    target: string,
    embed: boolean,
    unsupported = false,
  ) => {
    const p = n.position!;
    references.push({
      target,
      embed,
      wiki: false,
      line: p.start.line,
      column: p.start.column,
      start: p.start.offset!,
      end: p.end.offset!,
      unsupported,
    });
  };
  walk(tree, (n) => {
    if (
      [
        "code",
        "inlineCode",
        "yaml",
        "toml",
        "html",
        "definition",
        "link",
        "image",
        "linkReference",
        "imageReference",
      ].includes(n.type)
    )
      protectedRanges.push([
        n.position!.start.offset!,
        n.position!.end.offset!,
      ]);
    if (n.type === "link" || n.type === "image")
      add(n, n.url!, n.type === "image");
    if (n.type === "linkReference" || n.type === "imageReference")
      add(n, definitions.get(n.identifier!)!, n.type === "imageReference");
    if (n.type === "html") add(n, "HTML", false, true);
    if (
      n.type === "code" &&
      ["dataview", "dataviewjs"].includes(n.lang?.toLowerCase() ?? "")
    )
      add(n, n.lang!, false, true);
  });
  const escaped = (offset: number) => {
    let count = 0;
    while (offset > 0 && input[--offset] === "\\") count++;
    return count % 2 !== 0;
  };
  // Wiki tokens may contain Markdown emphasis characters. Match source ranges,
  // excluding AST regions whose content is literal or already a CommonMark link.
  for (const m of input.matchAll(/!?\[\[([^\]\r\n]+)\]\]/g)) {
    const start = m.index,
      end = start + m[0].length;
    if (
      escaped(start) ||
      protectedRanges.some(([a, b]) => start < b && end > a)
    )
      continue;
    const before = input.slice(0, start).split(/\r\n|\r|\n/);
    references.push({
      target: m[1]!.split("|")[0]!,
      embed: m[0].startsWith("!"),
      wiki: true,
      line: before.length,
      column: before.at(-1)!.length + 1,
      start,
      end,
      unsupported: format !== "obsidian-markdown",
    });
  }
  references.sort((a, b) => a.start - b.start);
  return { tree, references };
}
