import {
  commentPage,
  commentSubmission,
} from "../../../packages/api-contract/src/comments.js";
import {
  listPublicComments,
  submitComment,
  type CommentDatabase,
} from "./comments.js";

interface Environment {
  DB: CommentDatabase;
  COMMENT_SITE_ORIGIN?: string;
  COMMENT_ARTICLES: string[];
  COMMENT_LIMITER: {
    limit(input: { key: string }): Promise<{ success: boolean }>;
  };
}

function reply(
  status: number,
  data: unknown,
  headers: Record<string, string> = {},
) {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });
}

async function readSubmission(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) return reply(400, { error: "INVALID_COMMENT" });
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let size = 0,
    text = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 32768) {
        await reader.cancel();
        return reply(413, { error: "BODY_TOO_LARGE" });
      }
      text += decoder.decode(value, { stream: true });
    }
    const parsed = commentSubmission.safeParse(
      JSON.parse(text + decoder.decode()),
    );
    return parsed.success
      ? parsed.data
      : reply(400, { error: "INVALID_COMMENT" });
  } catch {
    return reply(400, { error: "INVALID_COMMENT" });
  } finally {
    reader.releaseLock();
  }
}

async function comments(request: Request, env: Environment): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname !== "/comments") return reply(404, { error: "NOT_FOUND" });
  try {
    if (request.method === "GET") {
      const args: Record<string, unknown> = Object.create(null);
      for (const [key, value] of url.searchParams) {
        if (
          Object.hasOwn(args, key) ||
          !["articleId", "after", "limit"].includes(key)
        )
          return reply(400, { error: "INVALID_PAGE" });
        args[key] =
          key === "articleId"
            ? value
            : /^\d+$/.test(value)
              ? Number(value)
              : NaN;
      }
      const page = commentPage.safeParse(args);
      if (!page.success) return reply(400, { error: "INVALID_PAGE" });
      if (
        !Array.isArray(env.COMMENT_ARTICLES) ||
        !env.COMMENT_ARTICLES.includes(page.data.articleId)
      )
        return reply(404, { error: "NOT_FOUND" });
      return reply(200, {
        comments: await listPublicComments(env.DB, page.data),
      });
    }
    if (request.method !== "POST")
      return reply(
        405,
        { error: "METHOD_NOT_ALLOWED" },
        { Allow: "GET, POST" },
      );
    if (
      request.headers
        .get("content-type")
        ?.split(";")[0]
        ?.trim()
        .toLowerCase() !== "application/json"
    )
      return reply(415, { error: "JSON_REQUIRED" });
    const submission = await readSubmission(request);
    if (submission instanceof Response) return submission;
    if (
      !Array.isArray(env.COMMENT_ARTICLES) ||
      !env.COMMENT_ARTICLES.includes(submission.articleId)
    )
      return reply(404, { error: "NOT_FOUND" });
    const key = request.headers.get("CF-Connecting-IP");
    if (!key) return reply(503, { error: "LIMITER_UNAVAILABLE" });
    const decision = await env.COMMENT_LIMITER.limit({ key });
    if (decision.success === false)
      return reply(429, { error: "RATE_LIMITED" });
    if (decision.success !== true)
      return reply(503, { error: "LIMITER_UNAVAILABLE" });
    await submitComment(env.DB, submission);
    return reply(202, { status: "pending" });
  } catch {
    return reply(503, { error: "SERVICE_UNAVAILABLE" });
  }
}
export default {
  async fetch(request: Request, env: Environment) {
    const origin = request.headers.get("Origin");
    if (!origin || new URL(request.url).pathname !== "/comments")
      return comments(request, env);
    if (
      origin !== env.COMMENT_SITE_ORIGIN &&
      origin !== new URL(request.url).origin
    )
      return reply(403, { error: "ORIGIN_DENIED" });
    const res =
      request.method === "OPTIONS"
        ? new Response(null, {
            status: 204,
            headers: {
              "Access-Control-Allow-Methods": "GET, POST",
              "Access-Control-Allow-Headers": "Content-Type",
            },
          })
        : await comments(request, env);
    res.headers.set("Access-Control-Allow-Origin", origin);
    res.headers.set("Vary", "Origin");
    return res;
  },
};
