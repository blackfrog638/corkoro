import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  configSchema,
  excluded,
  parseJson,
  type Config,
} from "../../content-contract/src/index.js";
import { Failure, failure } from "./errors.js";
export const hash = (b: Uint8Array) =>
  "sha256:" + createHash("sha256").update(b).digest("hex");
export const inside = (root: string, target: string) => {
  const r = path.relative(root, target);
  return (
    r === "" ||
    (!r.startsWith(`..${path.sep}`) && r !== ".." && !path.isAbsolute(r))
  );
};
export const forbidden = (p: string) =>
  p.split(/[\/\\]/).some((x) => excluded.has(x.toLowerCase()));
export async function canonical(p: string): Promise<string> {
  try {
    return await fs.realpath(p);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw failure(e);
    const parent = path.dirname(p);
    if (parent === p) throw failure(e);
    return path.join(await canonical(parent), path.basename(p));
  }
}
export async function readStable(p: string): Promise<Buffer> {
  const handle = await fs.open(p, "r");
  try {
    const a = await handle.stat({ bigint: true });
    if (!a.isFile())
      throw new Failure("IO_ERROR", 4, "Expected a regular file");
    const bytes = await handle.readFile();
    const b = await handle.stat({ bigint: true });
    const c = await fs.stat(p, { bigint: true });
    if (
      a.ino !== c.ino ||
      a.dev !== c.dev ||
      a.size !== b.size ||
      a.mtimeNs !== b.mtimeNs ||
      a.ctimeNs !== b.ctimeNs
    )
      throw new Failure("INPUT_CHANGED", 4);
    return bytes;
  } finally {
    await handle.close();
  }
}
export async function loadConfig(
  p: string,
): Promise<{ config: Config; bytes: Buffer; version: string }> {
  let bytes: Buffer;
  try {
    bytes = await readStable(p);
  } catch (e) {
    throw failure(e, "CONFIG_NOT_FOUND");
  }
  let raw: unknown;
  try {
    raw = parseJson(bytes);
  } catch {
    throw new Failure(
      "INVALID_CONFIG",
      2,
      "Invalid UTF-8 JSON or duplicate object key",
    );
  }
  if (
    raw &&
    typeof raw === "object" &&
    "schemaVersion" in raw &&
    raw.schemaVersion !== 1
  )
    throw new Failure("UNSUPPORTED_VERSION", 2);
  const checked = configSchema.safeParse(raw);
  if (!checked.success)
    throw new Failure(
      "INVALID_CONFIG",
      2,
      checked.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; "),
    );
  const config = checked.data,
    base = path.dirname(p),
    seen = new Set<string>();
  for (const name of [
    ...config.publication.entries.map((e) =>
      path.resolve(base, config.source.root, e.source),
    ),
    ...config.site.pages.map((e) => path.resolve(base, e.source)),
  ]) {
    if (seen.has(name))
      throw new Failure("INVALID_CONFIG", 2, "Duplicate article/page source");
    seen.add(name);
  }
  return { config, bytes, version: hash(bytes) };
}
export async function regularSource(p: string, root: string): Promise<string> {
  if (forbidden(p)) throw new Failure("PATH_OUT_OF_SCOPE", 3);
  const real = await fs.realpath(p);
  if (forbidden(real) || !inside(root, real))
    throw new Failure("PATH_OUT_OF_SCOPE", 3);
  if (!(await fs.stat(real, { bigint: true })).isFile())
    throw new Failure("MISSING_SOURCE", 3, "Expected a regular source file");
  return real;
}
export async function validatePaths(
  c: Config,
  configPath: string,
): Promise<void> {
  const base = path.dirname(configPath),
    root = await fs.realpath(path.resolve(base, c.source.root));
  if (
    !(await fs.stat(root)).isDirectory() ||
    forbidden(root) ||
    forbidden(configPath)
  )
    throw new Failure("PATH_OUT_OF_SCOPE", 3);
  const assets = await Promise.all(
    c.source.assetRoots.map(async (a) => {
      const r = await fs.realpath(path.resolve(base, a));
      if (!(await fs.stat(r)).isDirectory() || forbidden(r))
        throw new Failure("PATH_OUT_OF_SCOPE", 3);
      return r;
    }),
  );
  const output = await canonical(path.resolve(base, c.output.directory));
  if (
    [root, ...assets].some((r) => inside(r, output) || inside(output, r)) ||
    inside(output, await canonical(configPath))
  )
    throw new Failure("PATH_OUT_OF_SCOPE", 3, "Output overlaps inputs");
  let configIdentity = "";
  try {
    const st = await fs.stat(configPath, { bigint: true });
    configIdentity = `${st.dev}:${st.ino}`;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  const identities = new Set<string>();
  for (const e of [
    ...c.publication.entries.map((e) => ({
      source: path.resolve(root, e.source),
      publish: e.publish,
    })),
    ...c.site.pages.map((e) => ({
      source: path.resolve(base, e.source),
      publish: e.publish,
    })),
  ]) {
    if (!inside(root, await canonical(e.source)) || forbidden(e.source))
      throw new Failure("PATH_OUT_OF_SCOPE", 3);
    try {
      const real = await regularSource(e.source, root);
      const st = await fs.stat(real, { bigint: true });
      const key = `${st.dev}:${st.ino}`;
      if (key === configIdentity)
        throw new Failure(
          "PATH_OUT_OF_SCOPE",
          3,
          "Configuration cannot be published",
        );
      if (identities.has(key)) throw new Failure("DUPLICATE_SOURCE", 3);
      identities.add(key);
    } catch (err) {
      if (!e.publish && (err as NodeJS.ErrnoException).code === "ENOENT")
        continue;
      throw err;
    }
  }
  if (c.site.profile?.avatar) {
    const a = await regularSource(
      path.resolve(base, c.site.profile.avatar),
      root,
    );
    const st = await fs.stat(a, { bigint: true });
    if (`${st.dev}:${st.ino}` === configIdentity)
      throw new Failure("PATH_OUT_OF_SCOPE", 3);
    if (!assets.some((r) => inside(r, a)))
      throw new Failure("PATH_OUT_OF_SCOPE", 3, "Avatar outside asset roots");
  }
}
