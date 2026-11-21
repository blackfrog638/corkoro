import { z } from "zod";

// Keep the origin separate from the mount path so links cannot discard base.
export const siteAddressSchema = z.strictObject({
  origin: z.string().refine((value) => {
    try {
      const url = new URL(value);
      return ["https:", "http:"].includes(url.protocol) && value === url.origin;
    } catch {
      return false;
    }
  }, "Expected a canonical HTTP(S) origin without path, credentials or trailing slash"),
  base: z.string().refine(
    (value) =>
      value === "/" ||
      (value.startsWith("/") &&
        value.endsWith("/") &&
        value
          .slice(1, -1)
          .split("/")
          .every((segment) =>
            /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/.test(segment),
          )),
    "Expected / or slash-delimited ASCII URL segments with a trailing slash",
  ),
});
export const commentsOriginSchema = siteAddressSchema.shape.origin.refine(
  (value) => value.startsWith("https://"),
  "Expected HTTPS comments origin",
);
export type SiteAddress = z.infer<typeof siteAddressSchema>;
