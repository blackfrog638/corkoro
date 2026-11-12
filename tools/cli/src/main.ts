import {
  execute,
  Failure,
  type Request,
} from "../../../packages/publisher/src/index.js";
import {
  commandSchema,
  type Envelope,
} from "../../../packages/content-contract/src/index.js";
const args = process.argv.slice(2),
  json = args.includes("--json");
let command: Envelope["command"] = null;
const abort = new AbortController();
process.on("SIGINT", () => abort.abort());
process.on("SIGTERM", () => abort.abort());
function parse(): Request | "help" | "version" {
  if (args.length === 1 && args[0] === "--version") return "version";
  if (
    args.at(-1) === "--help" &&
    (args.length === 1 ||
      (args.length === 2 &&
        ["inspect", "init", "content", "check", "plan"].includes(args[0]!)) ||
      (args.length === 3 &&
        args[0] === "content" &&
        ["list", "add", "remove"].includes(args[1]!)))
  )
    return "help";
  let offset = 1;
  const name =
    args[0] === "content"
      ? ((offset = 2), `content ${args[1] ?? ""}`)
      : args[0];
  const known = commandSchema.safeParse(name);
  if (!known.success)
    throw new Failure(
      ["build", "preview", "deploy", "status", "comments"].includes(
        args[0] ?? "",
      )
        ? "UNSUPPORTED_COMMAND"
        : "INVALID_ARGUMENT",
      2,
    );
  command = known.data;
  const allowed: Record<string, string[]> = {
    inspect: ["source", "format", "json"],
    init: ["source", "config", "out-dir", "format", "json"],
    "content list": ["config", "json"],
    "content add": ["config", "slug", "id", "json"],
    "content remove": ["config", "json"],
    check: ["config", "json"],
    plan: ["config", "json"],
  };
  const values: Record<string, string> = {};
  const positions: string[] = [];
  for (let i = offset; i < args.length; i++) {
    const token = args[i]!;
    if (token.startsWith("--")) {
      const key = token.slice(2);
      if (!allowed[command]!.includes(key) || Object.hasOwn(values, key))
        throw new Failure("INVALID_ARGUMENT", 2, "Unknown or repeated option");
      if (key === "json") {
        values[key] = "true";
        continue;
      }
      const v = args[++i];
      if (!v || v.startsWith("--"))
        throw new Failure("INVALID_ARGUMENT", 2, "Missing option value");
      values[key] = v;
    } else positions.push(token);
  }
  const required =
    command === "inspect"
      ? ["source", "format"]
      : command === "init"
        ? ["source", "format", "config", "out-dir"]
        : command === "content add"
          ? ["config", "slug"]
          : ["config"];
  if (
    required.some((k) => !values[k]) ||
    positions.length !==
      (["content add", "content remove"].includes(command) ? 1 : 0) ||
    positions.some((s) => !s)
  )
    throw new Failure("INVALID_ARGUMENT", 2, "Missing or extra arguments");
  if (
    values.format &&
    !["markdown", "obsidian-markdown"].includes(values.format)
  )
    throw new Failure("INVALID_ARGUMENT", 2, "Unsupported source format");
  return {
    command,
    config: values.config,
    source: values.source,
    format: values.format as Request["format"],
    outDir: values["out-dir"],
    slug: values.slug,
    id: values.id,
    target: positions[0],
  };
}
try {
  const request = parse();
  if (request === "help")
    process.stdout.write(
      "Corkoro local CLI\ninspect --source <dir> --format <format> [--json]\ninit --source <dir> --config <file> --out-dir <dir> --format <format> [--json]\ncontent list --config <file> [--json]\ncontent add <source.md> --slug <slug> [--id <id>] --config <file> [--json]\ncontent remove <id> --config <file> [--json]\ncheck --config <file> [--json]\nPlanned: plan, build, preview, deploy, status, comments\n",
    );
  else if (request === "version") process.stdout.write("0.0.0\n");
  else {
    const result = await execute(request, abort.signal);
    process.exitCode = result.exitCode;
    process.stdout.write(
      json
        ? JSON.stringify(result) + "\n"
        : `${result.command}: ${result.ok ? "OK" : "FAILED"} (effect=${result.effect})\n${result.data ? JSON.stringify(result.data, null, 2) + "\n" : ""}${result.diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n")}\n`,
    );
  }
} catch (e) {
  const err = e instanceof Failure ? e : new Failure("INTERNAL_ERROR", 1);
  process.exitCode = err.exitCode;
  const result: Envelope = {
    schemaVersion: 1,
    command,
    ok: false,
    exitCode: err.exitCode,
    effect: "none",
    configVersion: null,
    data: null,
    diagnostics: [
      {
        code: err.code,
        severity: "error",
        message: err.message,
        location: null,
      },
    ],
  };
  process.stdout.write(
    json ? JSON.stringify(result) + "\n" : `${err.code}: ${err.message}\n`,
  );
}
