import {
  commentPage,
  commentSubmission,
  publicComment,
} from "../../../packages/api-contract/src/comments.js";

interface CommentDatabase {
  prepare(sql: string): {
    bind(...values: (string | number | null)[]): {
      run(): Promise<unknown>;
      all(): Promise<{ results: unknown[] }>;
    };
  };
}

export async function submitComment(db: CommentDatabase, input: unknown) {
  const comment = commentSubmission.parse(input);
  await db
    .prepare(
      "INSERT INTO comments (article_id, display_name, body, email) VALUES (?, ?, ?, ?)",
    )
    .bind(
      comment.articleId,
      comment.displayName,
      comment.body,
      comment.email ?? null,
    )
    .run();
}

export async function listPublicComments(db: CommentDatabase, input: unknown) {
  const page = commentPage.parse(input);
  const { results } = await db
    .prepare(
      "SELECT id, articleId, displayName, body, createdAt FROM public_comments WHERE articleId = ? AND id > ? ORDER BY id LIMIT ?",
    )
    .bind(page.articleId, page.after, page.limit)
    .all();
  return publicComment.array().parse(results);
}
