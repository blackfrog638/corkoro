import {
  moderationCursor,
  moderationDecision,
  publicComment,
} from "../../../packages/api-contract/src/comments.js";
import type { CommentDatabase } from "./comments.js";

interface AdminEnvironment {
  DB: CommentDatabase;
  ADMIN_TOKEN_SHA256: string;
}

function reply(status: number, data: unknown) {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

async function authorized(request: Request, digest: string) {
  const token = /^Bearer ([A-Za-z0-9_-]{43,128})$/.exec(
    request.headers.get("Authorization") ?? "",
  )?.[1];
  if (!token || !/^[a-f0-9]{64}$/.test(digest)) return false;
  const hash = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)),
  );
  let difference = 0;
  for (let i = 0; i < hash.length; i++)
    difference |= hash[i]! ^ parseInt(digest.slice(i * 2, i * 2 + 2), 16);
  return difference === 0;
}

export default {
  async fetch(request: Request, env: AdminEnvironment): Promise<Response> {
    try {
      if (!(await authorized(request, env.ADMIN_TOKEN_SHA256)))
        return reply(401, { error: "UNAUTHORIZED" });
      const url = new URL(request.url);
      if (url.pathname === "/admin/comments") {
        if (request.method !== "GET")
          return reply(405, { error: "METHOD_NOT_ALLOWED" });
        const raw = url.searchParams.get("after") ?? "0";
        const cursor = moderationCursor.safeParse(
          /^\d+$/.test(raw) ? Number(raw) : NaN,
        );
        if (
          !cursor.success ||
          [...url.searchParams.keys()].some((key) => key !== "after") ||
          url.searchParams.size > 1
        )
          return reply(400, { error: "INVALID_PAGE" });
        const { results } = await env.DB.prepare(
          "SELECT id, article_id AS articleId, display_name AS displayName, body, created_at AS createdAt FROM comments WHERE status='pending' AND id>? ORDER BY id LIMIT 50",
        )
          .bind(cursor.data)
          .all();
        return reply(200, { comments: publicComment.array().parse(results) });
      }
      const match = /^\/admin\/comments\/([1-9]\d*)\/(approve|reject)$/.exec(
        url.pathname,
      );
      if (!match) return reply(404, { error: "NOT_FOUND" });
      if (request.method !== "POST")
        return reply(405, { error: "METHOD_NOT_ALLOWED" });
      const id = Number(match[1]);
      if (!Number.isSafeInteger(id) || url.search)
        return reply(400, { error: "INVALID_REQUEST" });
      const decision = match[2] === "approve" ? "approved" : "rejected";
      const updated = await env.DB.prepare(
        "INSERT INTO comment_reviews (decision, comment_id) SELECT ?, id FROM comments WHERE id=? AND status='pending' RETURNING decision AS status",
      )
        .bind(decision, id)
        .all();
      const rows = updated.results.length
        ? updated.results
        : (
            await env.DB.prepare("SELECT status FROM comments WHERE id=?")
              .bind(id)
              .all()
          ).results;
      if (!rows.length) return reply(404, { error: "NOT_FOUND" });
      const state = moderationDecision.parse(
        (rows[0] as { status: unknown }).status,
      );
      return state === decision
        ? reply(200, { id, status: state })
        : reply(409, { error: "ALREADY_REVIEWED" });
    } catch {
      return reply(503, { error: "SERVICE_UNAVAILABLE" });
    }
  },
};
