import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { compare, repositoryGit } from "./git-site.js";
import { parseDeployment } from "../../../packages/content-contract/src/deployment.js";
import {
  envelopeSchema,
  requestSchema,
} from "../../../packages/content-contract/src/index.js";
import { Failure, cancelled } from "../../../packages/publisher/src/errors.js";
import type { Request } from "../../../packages/publisher/src/index.js";

export async function deploy(req: Request, signal: AbortSignal) {
  if (!requestSchema.safeParse(req).success)
    throw new Failure("INVALID_ARGUMENT", 2);
  const { snapshot: source, repository, branch, expected, deploymentId } = req;
  let snapshot;
  const bytes = await fs.readFile(source!);
  try {
    snapshot = parseDeployment(bytes);
  } catch {
    throw new Failure("INVALID_SNAPSHOT", 2);
  }
  if (snapshot.deploymentId !== deploymentId)
    throw new Failure("SNAPSHOT_CHANGED", 3);
  const report = compare(snapshot, repository!, branch!);
  if (report.conflict.length)
    throw new Failure("DEPLOY_CONFLICT", 3, report.conflict.join(", "));
  const git = repositoryGit(repository!);
  const ref = "refs/heads/" + branch;
  const message = "Corkoro site " + deploymentId;
  const changed = report.add.length + report.update.length > 0;
  if (
    report.commit !== expected &&
    (changed ||
      git(["show", "-s", "--format=%P%n%s", report.commit])
        .toString()
        .trim() !==
        expected + "\n" + message)
  )
    throw new Failure("BRANCH_CHANGED", 4);
  let commit = report.commit;
  cancelled(signal);
  if (changed) {
    if (
      git(["rev-parse", "--show-prefix"]).toString().trim() ||
      git(["for-each-ref", "--format=%(symref)", ref]).toString().trim()
    )
      throw new Failure("INVALID_DEPLOY_TARGET", 2);
    if (
      git(["worktree", "list", "--porcelain", "-z"])
        .toString()
        .split("\0")
        .includes("branch " + ref)
    )
      throw new Failure("BRANCH_CHECKED_OUT", 4);
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), "corkoro-index-"));
    try {
      const isolated = repositoryGit(repository!, path.join(temp, "index"));
      isolated(["read-tree", report.commit]);
      const changes = new Set([...report.add, ...report.update]);
      const entries = [];
      for (const file of snapshot.files) {
        if (!changes.has(file.path)) continue;
        cancelled(signal);
        const oid = isolated(
          ["hash-object", "-w", "--stdin"],
          Buffer.from(file.base64, "base64"),
        )
          .toString()
          .trim();
        entries.push("100644 " + oid + "\t" + file.path + "\0");
      }
      isolated(
        ["update-index", "-z", "--index-info"],
        Buffer.from(entries.join("")),
      );
      const tree = isolated(["write-tree"]).toString().trim();
      commit = isolated([
        "commit-tree",
        tree,
        "-p",
        report.commit,
        "-m",
        message,
      ])
        .toString()
        .trim();
    } finally {
      await fs.rm(temp, { recursive: true, force: true });
    }
    cancelled(signal);
    git(["update-ref", "--no-deref", ref, commit, report.commit]);
  }
  return envelopeSchema.parse({
    schemaVersion: 1,
    command: "deploy",
    ok: true,
    exitCode: 0,
    effect: changed ? "committed" : "none",
    configVersion: null,
    data: { deploymentId, branch, commit, stage: "local_commit" },
    diagnostics: [],
  });
}
