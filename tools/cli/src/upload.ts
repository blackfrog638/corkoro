import path from "node:path";
import { readFile } from "node:fs/promises";
import { parseDeployment } from "../../../packages/content-contract/src/deployment.js";
import { compare, repositoryGit } from "./git-site.js";
import { Failure } from "../../../packages/publisher/src/errors.js";

export async function uploadSite(
  snapshotFile: string,
  repo: string,
  branch: string,
  remote: string,
  expected: string,
  commit: string,
  id: string,
) {
  if (
    ![commit, expected].every((v) =>
      /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(v),
    ) ||
    !/^sha256:[a-f0-9]{64}$/.test(id)
  )
    throw new Failure("INVALID_ARGUMENT", 2);
  const local =
    path.isAbsolute(remote) &&
    !remote.startsWith("\\\\") &&
    !remote.startsWith("//");
  if (
    !local &&
    !/^https:\/\/github\.com\/[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+\.git$/.test(remote)
  )
    throw new Failure("INVALID_REMOTE", 2);
  const bytes = await readFile(snapshotFile);
  let snapshot;
  try {
    snapshot = parseDeployment(bytes);
  } catch {
    throw new Failure("INVALID_SNAPSHOT", 2);
  }
  if (snapshot.deploymentId !== id) throw new Failure("SNAPSHOT_CHANGED", 3);
  const plan = compare(snapshot, repo, branch);
  if (
    plan.commit !== commit ||
    plan.add.length ||
    plan.update.length ||
    plan.conflict.length
  )
    throw new Failure("LOCAL_SITE_CHANGED", 4);
  const git = repositoryGit(repo);
  if (
    commit !== expected &&
    git(["show", "-s", "--format=%P", commit]).toString().trim() !== expected
  )
    throw new Failure("BASE_MISMATCH", 4);
  const authorized = new Set(snapshot.files.map((f) => f.path));
  const changed = git([
    "diff-tree",
    "-r",
    "--no-renames",
    "--name-only",
    "-z",
    expected,
    commit,
  ])
    .toString("utf8")
    .split("\0")
    .filter(Boolean);
  if (changed.some((name) => !authorized.has(name)))
    throw new Failure("UNEXPECTED_COMMIT_FILES", 3);
  const ref = "refs/heads/" + branch;
  // Bind both operations to the same literal destination, including push URL rewrite checks.
  const target = local ? path.resolve(remote) : remote;
  const opts = [
    "-c",
    "protocol.allow=never",
    "-c",
    local ? "protocol.file.allow=always" : "protocol.https.allow=always",
    "-c",
    "http.followRedirects=false",
  ];
  const alias = "corkoro-upload-" + crypto.randomUUID();
  opts.push(
    "-c",
    "remote." + alias + ".url=" + target,
    "-c",
    "remote." + alias + ".pushurl=" + target,
  );
  // A configured pushurl bypasses pushInsteadOf. Reject fetch-side URL rewrites.
  if (
    git([...opts, "ls-remote", "--get-url", alias])
      .toString()
      .trimEnd() !== target
  )
    throw new Failure("REMOTE_REWRITTEN", 2);
  const tip = () =>
    git([...opts, "ls-remote", "--refs", alias, ref])
      .toString()
      .split("\t")[0];
  const result = {
    stage: "remote_commit",
    deploymentId: id,
    branch,
    remote: target,
    commit,
  };
  const current = tip();
  if (current === commit) return { ...result, changed: false };
  if (current !== expected) throw new Failure("REMOTE_BRANCH_CHANGED", 4);
  try {
    git([
      ...opts,
      "push",
      "--no-follow-tags",
      "--recurse-submodules=no",
      "--force-with-lease=" + ref + ":" + expected,
      alias,
      commit + ":" + ref,
    ]);
  } catch {
    let observed;
    try {
      observed = tip();
    } catch {
      throw new Failure("UPLOAD_UNKNOWN", 5);
    }
    if (observed !== commit) throw new Failure("UPLOAD_NOT_CONFIRMED", 4);
  }
  return { ...result, changed: true };
}
