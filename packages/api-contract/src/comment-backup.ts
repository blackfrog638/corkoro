import { z } from "zod";
import {
  publicComment,
  commentSubmission,
  moderationDecision,
} from "./comments.js";

const row = publicComment.extend({
  email: commentSubmission.shape.email.unwrap().nullable(),
  status: z.enum(["pending", "approved", "rejected"]),
  decision: moderationDecision.nullable(),
  reviewedAt: z.iso.datetime().nullable(),
});
export const commentBackup = z
  .strictObject({
    format: z.literal("corkoro-comments-v1"),
    sequence: z.number().int().nonnegative(),
    comments: z.array(row),
  })
  .superRefine((value, ctx) => {
    let previous = 0;
    for (const item of value.comments) {
      if (
        item.id <= previous ||
        item.id > value.sequence ||
        (item.decision === null) !== (item.reviewedAt === null) ||
        (item.decision !== null && item.decision !== item.status)
      )
        ctx.addIssue({ code: "custom", message: "Invalid comment history" });
      previous = item.id;
    }
  });
