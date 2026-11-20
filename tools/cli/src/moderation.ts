import { parseArgs } from "node:util";
import {
  moderationList,
  moderationReceipt,
} from "../../../packages/api-contract/src/comments.js";

export async function runModeration(args: string[], signal: AbortSignal) {
  const [action, ...rest] = args;
  const command = "comments " + action;
  function fail(exitCode: number, error: string) {
    return { command, ok: false, exitCode, error };
  }
  const list = action === "list";
  let values, positionals;
  try {
    const parsed = parseArgs({
      args: rest,
      allowPositionals: true,
      tokens: true,
      options: {
        origin: { type: "string" },
        json: { type: "boolean" },
        ...(list ? { after: { type: "string" as const } } : {}),
      },
    });
    const seen = new Set<string>();
    for (const token of parsed.tokens)
      if (token.kind === "option") {
        if (seen.has(token.name)) return fail(2, "INVALID_ARGUMENT");
        seen.add(token.name);
      }
    values = parsed.values;
    positionals = parsed.positionals;
  } catch {
    return fail(2, "INVALID_ARGUMENT");
  }
  const origin = values.origin;
  if (!origin || positionals.length !== (list ? 0 : 1))
    return fail(2, "INVALID_ARGUMENT");
  let url;
  try {
    url = new URL(origin);
  } catch {
    return fail(2, "INVALID_ORIGIN");
  }
  if (
    (origin !== url.origin && origin !== url.origin + "/") ||
    (url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        ["127.0.0.1", "[::1]"].includes(url.hostname)
      ))
  )
    return fail(2, "INVALID_ORIGIN");
  const number = list ? (values.after ?? "0") : positionals[0]!;
  if (
    typeof number !== "string" ||
    !/^\d+$/.test(number) ||
    !Number.isSafeInteger(Number(number)) ||
    (!list && Number(number) < 1)
  )
    return fail(2, "INVALID_ARGUMENT");
  const token = process.env.CORKORO_ADMIN_TOKEN;
  if (
    process.env.CORKORO_ADMIN_ORIGIN !== url.origin ||
    !token ||
    !/^[A-Za-z0-9_-]{43,128}$/.test(token)
  )
    return fail(2, "ADMIN_CREDENTIALS_UNAVAILABLE");
  url.pathname = list
    ? "/admin/comments"
    : "/admin/comments/" + Number(number) + "/" + action;
  if (list) url.searchParams.set("after", number);
  if (signal.aborted) return fail(130, "CANCELLED");
  try {
    const response = await fetch(url, {
      method: list ? "GET" : "POST",
      redirect: "error",
      signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]),
      headers: { Authorization: "Bearer " + token },
    });
    if ([401, 403, 404, 409].includes(response.status))
      return fail(4, "ADMIN_HTTP_" + response.status);
    if (response.status !== 200) throw new Error();
    const body: unknown = await response.json();
    const data = list
      ? moderationList.parse(body)
      : moderationReceipt.parse(body);
    if ("comments" in data) {
      let previousId = Number(number);
      for (const comment of data.comments) {
        if (comment.id <= previousId) throw new Error();
        previousId = comment.id;
      }
    }
    if (
      "id" in data &&
      (data.id !== Number(number) ||
        data.status !== (action === "approve" ? "approved" : "rejected"))
    )
      throw new Error();
    return { command, ok: true, exitCode: 0, data };
  } catch {
    return list
      ? fail(
          signal.aborted ? 130 : 4,
          signal.aborted ? "CANCELLED" : "ADMIN_QUERY_FAILED",
        )
      : fail(5, "MODERATION_OUTCOME_UNKNOWN");
  }
}
