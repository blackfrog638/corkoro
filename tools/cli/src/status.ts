import { z } from "zod";
import {
  envelopeSchema,
  requestSchema,
} from "../../../packages/content-contract/src/index.js";
import { cancelled, Failure } from "../../../packages/publisher/src/errors.js";
import type { Request } from "../../../packages/publisher/src/index.js";

const commit = z.string().regex(/^[a-f0-9]{40}$/);
const deployments = z.array(
  z.object({
    id: z.number().int().positive(),
    sha: commit,
    ref: z.string(),
    environment: z.literal("github-pages"),
  }),
);
const statuses = z.array(
  z.object({
    state: z.enum([
      "queued",
      "pending",
      "in_progress",
      "success",
      "failure",
      "error",
      "inactive",
    ]),
  }),
);

export async function status(
  request: Request,
  signal: AbortSignal,
  get = fetch,
) {
  const { repository, branch, expected } = request;
  if (!requestSchema.safeParse(request).success)
    throw new Failure("INVALID_ARGUMENT", 2);
  const base = "https://api.github.com/repos/" + repository + "/deployments";
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
  };
  if (process.env.GH_TOKEN)
    headers.Authorization = "Bearer " + process.env.GH_TOKEN;
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(30000)]);
  async function read(path: string) {
    const response = await get(base + path, {
      headers,
      signal: deadline,
      redirect: "error",
    });
    if (!response.ok)
      throw new Failure(
        "PAGES_QUERY_FAILED",
        4,
        "GitHub HTTP " + response.status,
      );
    return response.json();
  }
  try {
    const records = deployments.parse(
      await read("?environment=github-pages&per_page=20"),
    );
    let liveCommit: string | null = null;
    let target: string | undefined;
    for (const record of records) {
      const matches = record.sha === expected && record.ref === branch;
      if (liveCommit && (!matches || target !== undefined)) continue;
      const latest = statuses.parse(
        await read("/" + record.id + "/statuses?per_page=1"),
      )[0]?.state;
      if (matches && target === undefined) target = latest ?? "unknown";
      if (latest === "success" && !liveCommit) liveCommit = record.sha;
    }
    let state = "unknown";
    if (target === "success" && liveCommit === expected) state = "live";
    else if (target === "failure" || target === "error") state = "failed";
    else if (["queued", "pending", "in_progress"].includes(target ?? ""))
      state = "pending";
    else if (target === "inactive" || target === "success")
      state = "superseded";
    return envelopeSchema.parse({
      schemaVersion: 1,
      command: "status",
      ok: true,
      exitCode: 0,
      effect: "none",
      configVersion: null,
      data: { repository, branch, expected, liveCommit, state },
      diagnostics: [],
    });
  } catch (error) {
    cancelled(signal);
    if (error instanceof Failure) throw error;
    throw new Failure(
      "PAGES_QUERY_FAILED",
      4,
      "Unable to read GitHub deployment records",
    );
  }
}
