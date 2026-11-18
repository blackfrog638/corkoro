import { z } from "zod";
import { idSchema } from "../../content-contract/src/id.js";

export const commentSubmission = z.strictObject({
  articleId: idSchema,
  displayName: z.string().trim().min(1).max(80),
  body: z.string().trim().min(1).max(4000),
  email: z.email().max(254).optional(),
});

export const publicComment = commentSubmission.omit({ email: true }).extend({
  id: z.number().int().positive(),
  createdAt: z.iso.datetime(),
});

export const commentPage = z.strictObject({
  articleId: idSchema,
  after: z.number().int().nonnegative().default(0),
  limit: z.number().int().min(1).max(100).default(50),
});
