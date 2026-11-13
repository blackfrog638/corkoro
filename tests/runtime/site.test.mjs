import test from "node:test";
import assert from "node:assert/strict";
import { siteAddressSchema } from "../../dist/packages/content-contract/src/site.js";

test("site address separates origin and mount path without URL normalization surprises", () => {
  for (const origin of [
    "https://example.org",
    "http://localhost:4321",
    "https://blackfrog638.github.io",
  ])
    for (const base of ["/", "/corkoro/", "/notes/blog.v1/"])
      assert.deepEqual(siteAddressSchema.parse({ origin, base }), {
        origin,
        base,
      });
  for (const origin of [
    "https://example.org/",
    "https://example.org/blog",
    "https://a:b@example.org",
    "https://example.org?x",
    "https://example.org#x",
    "file:///tmp",
    "//example.org",
    " https://example.org",
    "https://EXAMPLE.org",
  ])
    assert.equal(
      siteAddressSchema.safeParse({ origin, base: "/" }).success,
      false,
      origin,
    );
  for (const base of [
    "blog",
    "/blog",
    "//host/",
    "/a//b/",
    "/../",
    "/%2e%2e/",
    "/a\\b/",
    "/a?b/",
    "/a#b/",
    "/中文/",
    "/a b/",
  ])
    assert.equal(
      siteAddressSchema.safeParse({ origin: "https://example.org", base })
        .success,
      false,
      base,
    );
  assert.equal(
    siteAddressSchema.safeParse({
      origin: "https://example.org",
      base: "/",
      extra: true,
    }).success,
    false,
  );
});
