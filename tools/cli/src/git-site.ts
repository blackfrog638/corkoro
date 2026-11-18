import { execFileSync } from "node:child_process";
import path from "node:path";
import { createHash } from "node:crypto";
import { devNull } from "node:os";
import { Failure } from "../../../packages/publisher/src/errors.js";
import type { DeploymentSnapshot } from "../../../packages/content-contract/src/deployment.js";

export function repositoryGit(repository: string, index?: string) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) => !name.toUpperCase().startsWith("GIT_"),
    ),
  );
  if (index) env.GIT_INDEX_FILE = index;
  return (args: string[], input?: Buffer) => {
    try {
      return execFileSync(
        "git",
        [
          "--no-replace-objects",
          "-c",
          "core.hooksPath=" + devNull,
          "-C",
          path.resolve(repository),
          ...args,
        ],
        {
          input,
          env,
          windowsHide: true,
          stdio: ["pipe", "pipe", "pipe"],
          maxBuffer: 64 * 1024 * 1024,
        },
      );
    } catch {
      throw new Failure(
        "GIT_OPERATION_FAILED",
        4,
        "Git operation failed: " + args[0],
      );
    }
  };
}
export function compare(
  snapshot: DeploymentSnapshot,
  repository: string,
  branch: string,
) {
  const git = repositoryGit(repository);
  const ref = "refs/heads/" + branch;
  git(["check-ref-format", ref]);
  const commit = git(["rev-parse", "--verify", ref + "^{commit}"])
    .toString()
    .trim();
  const records = new TextDecoder("utf-8", { fatal: true })
    .decode(git(["ls-tree", "-r", "-t", "-z", "--full-tree", commit]))
    .split("\0")
    .filter(Boolean);
  const tree = new Map<string, { mode: string; oid: string }>();
  for (const record of records) {
    const tab = record.indexOf("\t");
    const [mode, , oid] = record.slice(0, tab).split(" ");
    if (!mode || !oid) throw new Failure("INVALID_GIT_TREE", 4);
    tree.set(record.slice(tab + 1), { mode, oid });
  }
  const result = {
    branch,
    commit,
    deploymentId: snapshot.deploymentId,
    add: [] as string[],
    update: [] as string[],
    unchanged: [] as string[],
    preserve: [] as string[],
    conflict: [] as string[],
  };
  const incoming = new Set(snapshot.files.map((f) => f.path));
  for (const [name, entry] of tree)
    if (entry.mode !== "040000" && !incoming.has(name))
      result.preserve.push(name);
  for (const file of snapshot.files) {
    const parts = file.path.split("/");
    const entry = tree.get(file.path);
    if (
      parts.some((p) => p.startsWith(".")) ||
      parts[0]!.toLowerCase() === "cname" ||
      parts.slice(0, -1).some((_, i) => {
        const parent = tree.get(parts.slice(0, i + 1).join("/"));
        return parent && parent.mode !== "040000";
      }) ||
      (entry && entry.mode !== "100644")
    ) {
      result.conflict.push(file.path);
      continue;
    }
    if (!entry) {
      result.add.push(file.path);
      continue;
    }
    const bytes = Buffer.from(file.base64, "base64");
    const oid = createHash(commit.length === 40 ? "sha1" : "sha256")
      .update("blob " + bytes.length + "\0")
      .update(bytes)
      .digest("hex");
    result[entry.oid === oid ? "unchanged" : "update"].push(file.path);
  }
  return result;
}
