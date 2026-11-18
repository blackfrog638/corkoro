import { createServer } from "node:http";
import path from "node:path";
import { readSite } from "./index.js";
import { hash, readStable } from "../../../packages/publisher/src/files.js";
import { Failure } from "../../../packages/publisher/src/errors.js";

const types: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".wasm": "application/wasm",
  ".xml": "application/xml",
};

export async function startPreview(output: string, port = 4321) {
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new Failure("INVALID_ARGUMENT", 2, "Invalid preview port");
  const site = await readSite(output);
  // Serve captured, digest-checked bytes: later disk changes cannot expand the preview.
  const files = new Map<string, Buffer>();
  for (const entry of site.files) {
    const bytes = await readStable(path.join(site.siteDirectory, entry.path));
    if (hash(bytes) !== entry.hash) throw new Failure("SITE_CHANGED", 4);
    files.set(entry.path, bytes);
  }
  const bundle = files.get("content.bundle.json");
  if (!bundle) throw new Failure("SITE_CHANGED", 4);
  const base: string =
    JSON.parse(bundle.toString()).manifest.site.address?.base ?? "/";
  const server = createServer((req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { Allow: "GET, HEAD" }).end();
      return;
    }
    let pathname: string;
    try {
      pathname = decodeURIComponent((req.url ?? "").split("?")[0]!);
    } catch {
      res.writeHead(400).end();
      return;
    }
    if (
      !pathname.startsWith(base) ||
      pathname.includes("\\") ||
      pathname.split("/").some((p) => p === ".." || p === ".")
    ) {
      res.writeHead(404).end();
      return;
    }
    let name = pathname.slice(base.length);
    if (!name || name.endsWith("/")) name += "index.html";
    const bytes = files.get(name);
    if (!bytes) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, {
      "Content-Type": types[path.extname(name)] ?? "application/octet-stream",
      "Content-Length": bytes.length,
    });
    res.end(req.method === "HEAD" ? undefined : bytes);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Failure("IO_ERROR", 4);
  return {
    url: `http://127.0.0.1:${address.port}${base}`,
    buildId: site.buildId,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((e) => (e ? reject(e) : resolve()));
        server.closeAllConnections();
      }),
  };
}
